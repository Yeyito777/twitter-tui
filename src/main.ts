#!/usr/bin/env bun
/** twitter-tui — record-style Twitter/X terminal client. */

import { feedArgsForView, loadAccount, loadFeed, twitterCli } from "./backend";
import { displayCursor, handleEditorKey, resetEditor } from "./editor";
import { parseInput, PasteBuffer, type KeyEvent } from "./input";
import { render } from "./render";
import { clampSelection, createInitialState, focusNext, focusPrev, focusPrompt, focusSidebar, focusTimeline, selectedItem, setNotice, toggleContentFocus, VIEWS } from "./state";
import { beginTimelineLoad, cursorArgs, failTimelineLoad, finishLoadingOlderTimeline, setTimelineFeed, shouldLoadOlderTimeline, startLoadingOlderTimeline } from "./timelineloading";
import { moveTimelineCursorCols, moveTimelineCursorLineEnd, moveTimelineCursorLineStart, moveTimelineCursorRows, scrollTimelinePageWithCursor, scrollTimelineViewportSticky, scrollTimelineWithCursor, setTimelineCursorToRow } from "./timelinecursor";
import { isDmConversation, isDmMessage, isNotification, isTrend, isTweet, type FeedResult, type TimelineItem, type TweetItem } from "./types";
import { setTheme, THEME_NAMES, type ThemeName } from "./theme";
import { disableBracketedPaste, disableKittyKeyboard, enterAlt, enableBracketedPaste, enableKittyKeyboard, leaveAlt, resetCursorColor, setCursorColor } from "./terminal";
import { theme } from "./theme";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("twitter-tui needs an interactive TTY.");
  process.exit(1);
}

const state = createInitialState();
let running = true;
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let loadingTimer: ReturnType<typeof setInterval> | null = null;
let requestSeq = 0;
const startedAt = Date.now();
let swallowedLauncherEcho = false;

function stripInitialLauncherEcho(input: string): string {
  // xenv/st can inject the launched command line into the child pty right after
  // startup (observed as `/bin/twitter-tui\n`). Real terminals do not do this,
  // but swallowing it makes nested-display testing faithful instead of leaving
  // the app with its own executable path typed into the prompt.
  if (swallowedLauncherEcho || Date.now() - startedAt > 2500 || !input.includes("twitter-tui")) return input;
  swallowedLauncherEcho = true;
  const newline = input.indexOf("\n");
  if (newline >= 0) return input.slice(newline + 1);
  return "";
}

function scheduleRender(): void {
  syncLoading();
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    render(state);
  }, 8);
}

function syncLoading(): void {
  const active = state.notice.loading || state.timelineLoading || state.timelineLoadingOlder || state.timelineLoadingNewer || state.accountStatus === "loading";
  if (!active) {
    if (loadingTimer) clearInterval(loadingTimer);
    loadingTimer = null;
    state.loadingFrameIndex = 0;
    return;
  }
  if (loadingTimer) return;
  loadingTimer = setInterval(() => {
    state.loadingFrameIndex = (state.loadingFrameIndex + 1) % 1000;
    scheduleRender();
  }, 80);
}

function selectedTweet(item: TimelineItem | null = selectedItem(state)): TweetItem | null {
  if (!isTweet(item)) return null;
  return item.is_retweet && item.retweeted ? item.retweeted : item;
}

function selectedTweetId(): string | null {
  return selectedTweet()?.id ?? null;
}

function selectedUrl(): string | null {
  const item = selectedItem(state);
  const tweet = selectedTweet(item);
  if (tweet) return tweet.url;
  if (isNotification(item)) return item.url ?? null;
  if (isTrend(item)) return `https://x.com/search?q=${encodeURIComponent(item.name)}&src=trend_click`;
  if (state.profile) return state.profile.url;
  return null;
}

function applyFeed(feed: FeedResult, args: string[]): void {
  setTimelineFeed(state, feed, args);
  clampSelection(state);
  const matching = VIEWS.findIndex((view) => view.id === (feed.kind === "timeline" ? (args.includes("--latest") ? "latest" : "home") : feed.kind));
  if (matching >= 0) {
    state.sidebarIndex = matching;
    state.activeView = VIEWS[matching].id;
  } else {
    state.activeView = String(feed.kind);
  }
}

async function load(args: string[], title = "Loading"): Promise<void> {
  const seq = beginTimelineLoad(state);
  requestSeq = seq;
  setNotice(state, "", "muted", false);
  syncLoading();
  scheduleRender();
  try {
    const feed = await loadFeed(args);
    if (seq !== requestSeq) return;
    applyFeed(feed, args);
    setNotice(state, "", "success");
  } catch (error) {
    if (seq !== requestSeq) return;
    failTimelineLoad(state);
    setNotice(state, error instanceof Error ? error.message : String(error), "error");
  } finally {
    if (seq === requestSeq) {
      state.timelineLoading = false;
      syncLoading();
      scheduleRender();
    }
  }
}

async function maybeLoadOlderTimeline(): Promise<void> {
  if (!shouldLoadOlderTimeline(state) || !state.cursors.bottom) return;
  startLoadingOlderTimeline(state);
  syncLoading();
  scheduleRender();
  try {
    const feed = await loadFeed(cursorArgs(state.lastArgs, state.cursors.bottom));
    finishLoadingOlderTimeline(state, feed);
  } catch (error) {
    finishLoadingOlderTimeline(state, null);
    setNotice(state, error instanceof Error ? error.message : String(error), "error");
  } finally {
    syncLoading();
    scheduleRender();
  }
}

async function refresh(): Promise<void> {
  await load(state.lastArgs, "Refreshing");
}

async function hydrateAccount(): Promise<void> {
  state.accountStatus = "loading";
  state.account = null;
  scheduleRender();
  try {
    state.account = await loadAccount();
    state.accountStatus = "authenticated";
    scheduleRender();
  } catch {
    state.accountStatus = "error";
    state.account = null;
    // Feed loading is more important than account chrome; leave placeholders.
    scheduleRender();
  }
}

async function action(label: string, args: string[], after?: () => Promise<void> | void): Promise<void> {
  setNotice(state, `${label}…`, "muted", true);
  syncLoading();
  scheduleRender();
  try {
    const output = await twitterCli(args);
    setNotice(state, output || `${label} done`, "success");
    await after?.();
  } catch (error) {
    setNotice(state, error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.notice.loading = false;
    syncLoading();
    scheduleRender();
  }
}

function openUrl(url: string): void {
  const candidates = [
    ["qutebrowser-cli", "open", url],
    ["xdg-open", url],
  ];
  for (const command of candidates) {
    try {
      Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
      setNotice(state, `Opened ${url}`, "success");
      return;
    } catch {}
  }
  setNotice(state, `No opener found for ${url}`, "warning");
}

function setPrompt(text: string): void {
  resetEditor(state.editor, text, "insert");
  focusPrompt(state);
}

function pushHistory(command: string): void {
  if (!command.trim()) return;
  if (state.commandHistory.at(-1) !== command) state.commandHistory.push(command);
  state.commandHistoryIndex = null;
}

function commandHelp(): void {
  state.title = "Help";
  state.feedKind = "help";
  state.profile = null;
  state.items = [];
  state.scroll = 0;
  setNotice(state, "Commands: /home /latest /search <q> /user @name /profile @name /tweet <id> /thread [id] /post <text> /reply [id] <text> /like [id] /rt [id] /bookmark [id] /dms /dm <id|@user> /theme <name>", "muted");
}

function splitCommand(input: string): string[] {
  const parts: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) parts.push(m[1] ?? m[2] ?? m[3] ?? "");
  return parts;
}

async function submit(text: string): Promise<void> {
  const raw = text.trim();
  if (!raw) return;
  pushHistory(text);
  resetEditor(state.editor, "", "insert");

  if (!raw.startsWith("/")) {
    if (state.currentDmConversationId && state.feedKind === "dm") {
      await action("Sending DM", ["dm", state.currentDmConversationId, "--send", raw], () => load(["dm", state.currentDmConversationId!], "Reloading DM"));
    } else if (state.replyTargetId) {
      const id = state.replyTargetId;
      state.replyTargetId = null;
      await action("Replying", ["reply", id, raw], refresh);
    } else if (state.quoteTargetId) {
      const id = state.quoteTargetId;
      state.quoteTargetId = null;
      await action("Quote tweeting", ["post", "--quote", id, raw], refresh);
    } else {
      await action("Posting", ["post", raw], refresh);
    }
    return;
  }

  const withoutSlash = raw.slice(1);
  const [cmdRaw, ...rest] = splitCommand(withoutSlash);
  const cmd = (cmdRaw ?? "").toLowerCase();
  const restText = withoutSlash.slice(cmdRaw.length).trimStart();
  switch (cmd) {
    case "h":
    case "help": commandHelp(); break;
    case "home": await load(["timeline", "-n", "35"], "Home"); break;
    case "latest": await load(["timeline", "--latest", "-n", "35"], "Latest"); break;
    case "refresh": await refresh(); break;
    case "notif":
    case "notifications": await load(["notifications", "-n", "35"], "Notifications"); break;
    case "bookmarks": await load(["bookmarks", "-n", "35"], "Bookmarks"); break;
    case "bms": await load(["bookmarks", "-n", "35"], "Bookmarks"); break;
    case "trends":
    case "trending": await load(["trending", "-n", "35"], "Trending"); break;
    case "search":
    case "s":
      if (!restText) setNotice(state, "usage: /search <query>", "warning");
      else await load(["search", "-n", "35", ...rest], "Search");
      break;
    case "user":
    case "tweets":
      if (!rest[0]) setNotice(state, "usage: /user @handle", "warning");
      else await load(["tweets", rest[0], "-n", "35"], `@${rest[0].replace(/^@/, "")}`);
      break;
    case "profile":
    case "p":
      if (!rest[0]) setNotice(state, "usage: /profile @handle", "warning");
      else await load(["profile", rest[0]], `@${rest[0].replace(/^@/, "")}`);
      break;
    case "tweet":
      if (!rest[0]) setNotice(state, "usage: /tweet <id|url>", "warning");
      else await load(["tweet", rest[0]], "Tweet");
      break;
    case "thread": {
      const id = rest[0] ?? selectedTweetId();
      if (!id) setNotice(state, "usage: /thread <id|url> or select a tweet", "warning");
      else await load(["thread", id], "Thread");
      break;
    }
    case "dms": await load(["dms"], "DMs"); break;
    case "dm":
      if (!rest[0]) setNotice(state, "usage: /dm <conversation-id|@handle>", "warning");
      else await load(["dm", rest[0]], "DM");
      break;
    case "post":
    case "tweetit":
      if (!restText) setNotice(state, "usage: /post <text>", "warning");
      else await action("Posting", ["post", restText], refresh);
      break;
    case "reply": {
      const maybeId = rest[0] && /^\d{5,}|https?:/.test(rest[0]) ? rest[0] : selectedTweetId();
      const replyText = maybeId === rest[0] ? rest.slice(1).join(" ") : restText;
      if (!maybeId || !replyText) setNotice(state, "usage: /reply [tweet] <text>", "warning");
      else await action("Replying", ["reply", maybeId, replyText], refresh);
      break;
    }
    case "quote": {
      const maybeId = rest[0] && /^\d{5,}|https?:/.test(rest[0]) ? rest[0] : selectedTweetId();
      const quoteText = maybeId === rest[0] ? rest.slice(1).join(" ") : restText;
      if (!maybeId || !quoteText) setNotice(state, "usage: /quote [tweet] <text>", "warning");
      else await action("Quote tweeting", ["post", "--quote", maybeId, quoteText], refresh);
      break;
    }
    case "like": {
      const id = rest[0] ?? selectedTweetId();
      if (!id) setNotice(state, "select a tweet or pass id", "warning");
      else await action("Liking", ["like", id]);
      break;
    }
    case "unlike": {
      const id = rest[0] ?? selectedTweetId();
      if (!id) setNotice(state, "select a tweet or pass id", "warning");
      else await action("Unliking", ["unlike", id]);
      break;
    }
    case "rt":
    case "retweet": {
      const id = rest[0] ?? selectedTweetId();
      if (!id) setNotice(state, "select a tweet or pass id", "warning");
      else await action("Retweeting", ["rt", id]);
      break;
    }
    case "unrt": {
      const id = rest[0] ?? selectedTweetId();
      if (!id) setNotice(state, "select a tweet or pass id", "warning");
      else await action("Undoing retweet", ["unrt", id]);
      break;
    }
    case "bookmark":
    case "bm": {
      const id = rest[0] ?? selectedTweetId();
      if (!id) setNotice(state, "select a tweet or pass id", "warning");
      else await action("Bookmarking", ["bookmark", id]);
      break;
    }
    case "delete":
      if (!rest[0]) setNotice(state, "usage: /delete <your tweet id>", "warning");
      else await action("Deleting", ["delete", rest[0]], refresh);
      break;
    case "open": {
      const url = rest[0] ?? selectedUrl();
      if (!url) setNotice(state, "nothing openable selected", "warning");
      else openUrl(url);
      break;
    }
    case "theme": {
      const name = rest[0] as ThemeName | undefined;
      if (!name || !THEME_NAMES.includes(name)) setNotice(state, `themes: ${THEME_NAMES.join(", ")}`, "warning");
      else {
        const err = setTheme(name);
        setNotice(state, err ? `theme changed but not persisted: ${err}` : `theme: ${name}`, err ? "warning" : "success");
      }
      break;
    }
    case "quit":
    case "q": running = false; shutdown(); break;
    default: setNotice(state, `unknown command: /${cmd}. Try /help`, "warning");
  }
}

function moveSelection(delta: number): void {
  state.selectedIndex += delta;
  clampSelection(state);
}

function sidebarMove(delta: number): void {
  state.sidebarIndex = Math.max(0, Math.min(VIEWS.length - 1, state.sidebarIndex + delta));
}

function timelineFocused(): boolean {
  return state.panelFocus === "content" && state.contentFocus === "timeline";
}

function afterTimelineCursorMove(): void {
  void maybeLoadOlderTimeline();
}

function timelinePageSize(): number {
  const rows = Math.max(10, state.rows);
  const statusRows = 1;
  const promptRows = 1;
  const bodyTop = 3;
  return Math.max(1, (rows - statusRows - promptRows - 2) - bodyTop);
}

function scrollFocusedTimeline(kind: "line" | "amount" | "page", dir: number, amount: number): void {
  if (!timelineFocused()) return;
  const visibleRows = timelinePageSize();
  if (kind === "line") scrollTimelineViewportSticky(state, dir, visibleRows);
  else if (kind === "page") scrollTimelinePageWithCursor(state, dir, amount, visibleRows);
  else scrollTimelineWithCursor(state, dir, amount, visibleRows);
  afterTimelineCursorMove();
}

function commandHistory(delta: number): boolean {
  if (state.commandHistory.length === 0 || state.editor.buffer.length > 0 && state.commandHistoryIndex === null) return false;
  const start = state.commandHistoryIndex ?? state.commandHistory.length;
  const next = Math.max(0, Math.min(state.commandHistory.length - 1, start + delta));
  state.commandHistoryIndex = next;
  resetEditor(state.editor, state.commandHistory[next] ?? "", "insert");
  return true;
}

async function activateSelection(): Promise<void> {
  if (state.panelFocus === "sidebar") {
    const view = VIEWS[state.sidebarIndex];
    if (view) await load(feedArgsForView(view.id), view.label);
    return;
  }
  const item = selectedItem(state);
  if (isDmConversation(item)) {
    await load(["dm", item.id], "DM");
    return;
  }
  if (isTrend(item)) {
    await load(["search", "-n", "35", item.name], `Search ${item.name}`);
    return;
  }
  const id = selectedTweetId();
  if (id) {
    const tweet = selectedTweet();
    state.title = `Thread ${id}`;
    state.feedKind = "thread";
    state.activeView = "thread";
    state.items = tweet ? [tweet] : [];
    state.profile = null;
    state.selectedIndex = 0;
    state.scroll = Number.MAX_SAFE_INTEGER;
    focusTimeline(state);
    await load(["thread", id], "Thread");
  }
}

function prepareReply(): void {
  const id = selectedTweetId();
  if (!id) {
    setNotice(state, "Select a tweet to reply.", "warning");
    return;
  }
  state.replyTargetId = id;
  setPrompt("");
  const tweet = selectedTweet();
  setNotice(state, `Replying to @${tweet?.handle ?? id}`, "muted");
}

function prepareQuote(): void {
  const id = selectedTweetId();
  if (!id) {
    setNotice(state, "Select a tweet to quote.", "warning");
    return;
  }
  state.quoteTargetId = id;
  setPrompt("");
  const tweet = selectedTweet();
  setNotice(state, `Quote tweeting @${tweet?.handle ?? id}`, "muted");
}

async function handleGlobalKey(key: KeyEvent): Promise<boolean> {
  if (key.event === "release") return true;
  if (key.type === "ctrl-c" || key.type === "ctrl-q") {
    running = false;
    shutdown();
    return true;
  }
  if (key.type === "ctrl-s" || key.type === "ctrl-m") {
    state.sidebarOpen = !state.sidebarOpen;
    if (!state.sidebarOpen && state.panelFocus === "sidebar") focusTimeline(state);
    return true;
  }
  if (key.type === "ctrl-j") {
    focusNext(state);
    return true;
  }
  if (key.type === "ctrl-k") {
    focusPrev(state);
    return true;
  }
  if (key.type === "ctrl-n") {
    toggleContentFocus(state);
    return true;
  }
  if (key.type === "ctrl-r") {
    void refresh();
    return true;
  }
  if (timelineFocused()) {
    const halfPage = Math.max(1, Math.floor(timelinePageSize() / 2));
    const fullPage = Math.max(1, timelinePageSize());
    if (key.type === "ctrl-e") { scrollFocusedTimeline("line", -1, 1); return true; }
    if (key.type === "ctrl-y") { scrollFocusedTimeline("line", 1, 1); return true; }
    if (key.type === "ctrl-d") { scrollFocusedTimeline("amount", -1, halfPage); return true; }
    if (key.type === "ctrl-u") { scrollFocusedTimeline("amount", 1, halfPage); return true; }
    if (key.type === "ctrl-f") { scrollFocusedTimeline("page", -1, fullPage); return true; }
    if (key.type === "ctrl-b") { scrollFocusedTimeline("page", 1, fullPage); return true; }
  }
  return false;
}

async function handlePromptKey(key: KeyEvent): Promise<void> {
  if (key.type === "up" && commandHistory(-1)) return;
  if (key.type === "down" && state.commandHistoryIndex !== null) {
    if (state.commandHistoryIndex >= state.commandHistory.length - 1) {
      state.commandHistoryIndex = null;
      resetEditor(state.editor, "", "insert");
    } else commandHistory(1);
    return;
  }
  const actionResult = handleEditorKey(state.editor, key);
  if (actionResult === "submit") await submit(state.editor.buffer);
  else if (actionResult === "quit") {
    running = false;
    shutdown();
  } else if (actionResult === "scroll_top") {
    state.selectedIndex = 0; state.scroll = 0;
  } else if (actionResult === "scroll_bottom") {
    state.selectedIndex = Math.max(0, state.items.length - 1);
  }
}

async function handleKey(key: KeyEvent): Promise<void> {
  if (await handleGlobalKey(key)) return;
  if (state.panelFocus === "content" && state.contentFocus === "prompt") {
    if (state.editor.mode === "normal" && key.type === "char") {
      switch (key.char) {
        case "q": running = false; shutdown(); return;
        case "j": focusTimeline(state); moveSelection(1); return;
        case "k": focusTimeline(state); moveSelection(-1); return;
        case "/": resetEditor(state.editor, "/", "insert"); return;
      }
    }
    await handlePromptKey(key);
    return;
  }

  if (key.type === "escape") { focusPrompt(state); return; }
  if (key.type === "enter") { await activateSelection(); return; }
  if (key.type === "up") { state.panelFocus === "sidebar" ? sidebarMove(-1) : timelineFocused() ? (moveTimelineCursorRows(state, -1), afterTimelineCursorMove()) : moveSelection(-1); return; }
  if (key.type === "down") { state.panelFocus === "sidebar" ? sidebarMove(1) : timelineFocused() ? (moveTimelineCursorRows(state, 1), afterTimelineCursorMove()) : moveSelection(1); return; }
  if (key.type === "left") { if (timelineFocused()) moveTimelineCursorCols(state, -1); return; }
  if (key.type === "right") { if (timelineFocused()) moveTimelineCursorCols(state, 1); return; }
  if (key.type !== "char" || !key.char) return;
  switch (key.char) {
    case "q": running = false; shutdown(); return;
    case "i": focusPrompt(state); return;
    case "a": focusPrompt(state); resetEditor(state.editor, state.editor.buffer, "insert"); state.editor.cursor = state.editor.buffer.length; return;
    case "/": setPrompt("/"); return;
    case "s": focusSidebar(state); return;
    case "t": focusTimeline(state); return;
    case "j": state.panelFocus === "sidebar" ? sidebarMove(1) : timelineFocused() ? (moveTimelineCursorRows(state, 1), afterTimelineCursorMove()) : moveSelection(1); return;
    case "k": state.panelFocus === "sidebar" ? sidebarMove(-1) : timelineFocused() ? (moveTimelineCursorRows(state, -1), afterTimelineCursorMove()) : moveSelection(-1); return;
    case "h": if (timelineFocused()) moveTimelineCursorCols(state, -1); return;
    case "l": if (timelineFocused()) { moveTimelineCursorCols(state, 1); return; }
      {
        const id = selectedTweetId();
        if (id) void action("Liking", ["like", id]);
        else setNotice(state, "Select a tweet to like", "warning");
        return;
      }
    case "0": if (timelineFocused()) moveTimelineCursorLineStart(state); return;
    case "$": if (timelineFocused()) moveTimelineCursorLineEnd(state); return;
    case "g": state.panelFocus === "sidebar" ? state.sidebarIndex = 0 : timelineFocused() ? (setTimelineCursorToRow(state, 0), afterTimelineCursorMove()) : (state.selectedIndex = 0, state.scroll = 0); return;
    case "G": state.panelFocus === "sidebar" ? state.sidebarIndex = VIEWS.length - 1 : timelineFocused() ? (setTimelineCursorToRow(state, Math.max(0, state.timelineLinePlain.length - 1)), afterTimelineCursorMove()) : (state.selectedIndex = Math.max(0, state.items.length - 1)); return;
    case "r": prepareReply(); return;
    case "Q": prepareQuote(); return;
    case "b": {
      const id = selectedTweetId();
      if (id) void action("Bookmarking", ["bookmark", id]);
      else setNotice(state, "Select a tweet to bookmark", "warning");
      return;
    }
    case "R": {
      const id = selectedTweetId();
      if (id) void action("Retweeting", ["rt", id]);
      else setNotice(state, "Select a tweet to retweet", "warning");
      return;
    }
    case "o": {
      const url = selectedUrl();
      if (url) openUrl(url);
      else setNotice(state, "Nothing openable selected", "warning");
      return;
    }
    case "u": {
      const tweet = selectedTweet();
      if (tweet) void load(["tweets", `@${tweet.handle}`, "-n", "35"], `@${tweet.handle}`);
      return;
    }
  }
}

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (loadingTimer) clearInterval(loadingTimer);
  if (renderTimer) clearTimeout(renderTimer);
  try { process.stdin.setRawMode(false); } catch {}
  process.stdin.pause();
  process.stdout.write(disableBracketedPaste + disableKittyKeyboard + resetCursorColor + leaveAlt);
  setTimeout(() => process.exit(0), 0);
}

function start(): void {
  process.stdout.write(enterAlt + enableBracketedPaste + enableKittyKeyboard + (theme.cursorColor ? setCursorColor(theme.cursorColor) : ""));
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const paste = new PasteBuffer((text) => void handleKey({ type: "paste", text }));
  process.stdin.on("data", (chunk: string) => {
    const buffered = paste.feed(Buffer.from(chunk, "utf8"));
    if (buffered === null) return;
    const cleaned = stripInitialLauncherEcho(buffered);
    if (!cleaned) return;
    for (const key of parseInput(cleaned)) {
      void handleKey(key).finally(scheduleRender);
    }
  });
  process.stdout.on("resize", () => {
    state.cols = process.stdout.columns || state.cols;
    state.rows = process.stdout.rows || state.rows;
    scheduleRender();
  });
  process.on("SIGINT", () => { running = false; shutdown(); process.exit(0); });
  process.on("SIGTERM", () => { running = false; shutdown(); process.exit(0); });
  render(state);
  void hydrateAccount();
  void load(["timeline", "-n", "35"], "Home");
}

start();
