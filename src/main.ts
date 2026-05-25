#!/usr/bin/env bun
/** twitter-tui — record-style Twitter/X terminal client. */

import { feedArgsForView, loadAccount, loadFeed, twitterCli } from "./backend";
import { acceptAutocomplete, cycleAutocomplete, dismissAutocomplete, tryPathComplete, updateAutocomplete } from "./autocomplete";
import { loadConfiguredCredentials, loadSavedLoginsSafe, logoutCredentials, resolveLoginCredential, restoreTwitterCliCredentials, saveValidatedLogin, snapshotTwitterCliCredentials, writeTwitterCliCredentials } from "./authflow";
import { tryCommand, type CommandResult } from "./commands";
import { cachedFeedForArgs, flushTwitterCacheSync, saveFeedForArgs, sidebarSurfaceKeyFromArgs, threadIdFromArgs } from "./datacache";
import { displayCursor, handleEditorKey, resetEditor } from "./editor";
import { parseInput, PasteBuffer, type KeyEvent } from "./input";
import { openTargetDetached } from "./openable";
import { render } from "./render";
import { clampSelection, createInitialState, focusNext, focusPrev, focusPrompt, focusSidebar, focusTimeline, selectedItem, setNotice, VIEWS, type TimelineSnapshot } from "./state";
import { beginTimelineLoad, cursorArgs, failTimelineLoad, finishLoadingOlderTimeline, setTimelineFeed, shouldLoadOlderTimeline, startLoadingOlderTimeline } from "./timelineloading";
import { moveTimelineCursorCols, moveTimelineCursorLineEnd, moveTimelineCursorLineStart, moveTimelineCursorRows, placeTimelineCursorAtVisibleBottom, scrollTimelinePageWithCursor, scrollTimelineViewportSticky, scrollTimelineWithCursor, setTimelineCursorToRow } from "./timelinecursor";
import { openableTargetAtTimelineCursor } from "./timelineopenable";
import { handleTimelineVisualKey } from "./timelinevisual";
import { isDmConversation, isDmMessage, isNotification, isTrend, isTweet, type FeedResult, type TimelineItem, type TweetItem } from "./types";
import { disableBracketedPaste, disableKittyKeyboard, enableAutowrap, enterAlt, enableBracketedPaste, enableKittyKeyboard, leaveAlt, resetCursorColor, setCursorColor, showCursor } from "./terminal";
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
  const viewKind = feed.kind === "timeline" ? "home" : feed.kind;
  const matching = VIEWS.findIndex((view) => view.id === viewKind);
  if (matching >= 0) {
    state.sidebarIndex = matching;
    state.activeView = VIEWS[matching].id;
  } else {
    state.activeView = String(feed.kind);
  }
}

function cacheAccountId(): string | null {
  return state.account?.id ?? null;
}

function cachedFeedForCurrentAccount(args: string[]): FeedResult | null {
  const accountId = cacheAccountId();
  if (!accountId) return null;
  const cached = cachedFeedForArgs(accountId, args);
  return cached?.feed ?? null;
}

function isCacheableArgs(args: string[]): boolean {
  return sidebarSurfaceKeyFromArgs(args) !== null || threadIdFromArgs(args) !== null;
}

function persistFeedForArgs(args: string[], feed: FeedResult): void {
  const accountId = cacheAccountId();
  if (!accountId) return;
  if (!isCacheableArgs(args)) return;
  saveFeedForArgs(accountId, args, feed);
}

function currentFeedResult(): FeedResult {
  return {
    ok: true,
    kind: state.feedKind,
    title: state.title,
    items: state.items,
    cursors: { ...state.cursors },
    profile: state.profile ?? undefined,
    conversation_id: state.currentDmConversationId ?? undefined,
  };
}

function loadingLabelFor(title: string, args: string[]): string {
  if (args[0] === "timeline" && args.includes("--latest")) return "Loading Latest…";
  if (args[0] === "timeline") return "Loading Timeline…";
  if (args[0] === "notifications") return "Loading Notifs…";
  if (args[0] === "bookmarks") return "Loading Bookmarks…";
  if (args[0] === "trending") return "Loading Trends…";
  if (args[0] === "profile") return "Loading Profile…";
  if (args[0] === "dms") return "Loading DMs…";
  if (args[0] === "search") return "Loading Search…";
  if (args[0] === "tweets") return `Loading @${String(args[1] ?? "user").replace(/^@/, "")}…`;
  if (args[0] === "thread") return "Loading Replies…";
  return `Loading ${title.toLowerCase()}…`;
}

function shouldClearBeforeLoad(args: string[]): boolean {
  return ["timeline", "notifications", "bookmarks", "trending", "dms", "search", "tweets", "profile"].includes(args[0] ?? "");
}

async function load(args: string[], title = "Loading"): Promise<void> {
  const cachedFeed = cachedFeedForCurrentAccount(args);
  const label = loadingLabelFor(title, args);
  const seq = beginTimelineLoad(state, label, shouldClearBeforeLoad(args) && !cachedFeed);
  requestSeq = seq;
  setNotice(state, "", "muted", false);
  if (cachedFeed) {
    applyFeed(cachedFeed, args);
    state.timelineLoading = true;
    state.timelineLoadingLabel = label;
  }
  syncLoading();
  scheduleRender();
  try {
    const feed = await loadFeed(args);
    if (seq !== requestSeq) return;
    applyFeed(feed, args);
    persistFeedForArgs(args, feed);
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
    persistFeedForArgs(state.lastArgs, currentFeedResult());
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
  state.savedLogins = loadSavedLoginsSafe();
  state.accountStatus = "loading";
  state.account = null;
  scheduleRender();
  try {
    const configuredCredentials = loadConfiguredCredentials();
    if (configuredCredentials) writeTwitterCliCredentials(configuredCredentials);
    state.account = await loadAccount();
    state.accountStatus = "authenticated";
    if (configuredCredentials) state.savedLogins = saveValidatedLogin(state.savedLogins, state.account, configuredCredentials);
    if (state.items.length > 0) persistFeedForArgs(state.lastArgs, currentFeedResult());
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
  if (openTargetDetached(url)) {
    setNotice(state, `Opened ${url}`, "success");
    return;
  }
  setNotice(state, `No opener found for ${url}`, "warning");
}

function setPrompt(text: string): void {
  resetEditor(state.editor, text, "insert");
  focusPrompt(state);
  updateAutocomplete(state);
}

function pushHistory(command: string): void {
  if (!command.trim()) return;
  if (state.commandHistory.at(-1) !== command) state.commandHistory.push(command);
  state.commandHistoryIndex = null;
}

async function applyCommandResult(result: CommandResult | null, raw: string): Promise<boolean> {
  if (!result) return false;
  switch (result.type) {
    case "handled": return true;
    case "quit": running = false; shutdown(); return true;
    case "login": void login(result.credential); return true;
    case "logout": logout(); return true;
    case "theme_changed":
      process.stdout.write(theme.cursorColor ? setCursorColor(theme.cursorColor) : resetCursorColor);
      scheduleRender();
      return true;
  }
}

async function login(credential: string): Promise<void> {
  const credentials = resolveLoginCredential(state.savedLogins, credential);
  if (!credentials) {
    setNotice(state, "Usage: /login [saved-login|auth_token ct0]", "warning");
    scheduleRender();
    return;
  }

  state.accountStatus = "loading";
  state.account = null;
  setNotice(state, "Validating Twitter credentials…", "muted", true);
  scheduleRender();
  const previousCredentials = snapshotTwitterCliCredentials();
  try {
    writeTwitterCliCredentials(credentials);
    const account = await loadAccount();
    state.account = account;
    state.accountStatus = "authenticated";
    state.savedLogins = saveValidatedLogin(state.savedLogins, account, credentials);
    setNotice(state, "", "muted");
  } catch (error) {
    restoreTwitterCliCredentials(previousCredentials);
    state.accountStatus = "error";
    setNotice(state, error instanceof Error ? error.message : String(error), "error");
  } finally {
    scheduleRender();
  }
}

function logout(): void {
  try {
    logoutCredentials();
  } catch (error) {
    setNotice(state, `Failed to clear config: ${(error as Error).message}`, "error");
    scheduleRender();
    return;
  }
  state.accountStatus = "error";
  state.account = null;
  state.autocomplete = null;
  setNotice(state, "Logged out.", "success");
  scheduleRender();
}

async function submit(text: string): Promise<void> {
  const raw = text.trim();
  if (!raw) return;
  pushHistory(text);
  resetEditor(state.editor, "", "insert");
  state.autocomplete = null;

  if (!raw.startsWith("/")) {
    if (state.currentDmConversationId && state.feedKind === "dm") {
      await action("Sending DM", ["dm", state.currentDmConversationId, "--send", raw], () => load(["dm", state.currentDmConversationId!], "Reloading DM"));
    } else if (state.replyTargetId) {
      const id = state.replyTargetId;
      state.replyTargetId = null;
      setNotice(state, "", "muted");
      await action("Replying", ["reply", id, raw], refresh);
    } else if (state.quoteTargetId) {
      const id = state.quoteTargetId;
      state.quoteTargetId = null;
      setNotice(state, "", "muted");
      await action("Quote tweeting", ["post", "--quote", id, raw], refresh);
    } else {
      await action("Posting", ["post", raw], refresh);
    }
    return;
  }

  if (await applyCommandResult(tryCommand(raw, state), raw)) return;
  const name = raw.split(/\s+/)[0];
  setNotice(state, `Unknown command: ${name}`, "error");
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

function currentTimelineSnapshot(): TimelineSnapshot {
  return {
    activeView: state.activeView,
    title: state.title,
    feedKind: state.feedKind,
    items: [...state.items],
    profile: state.profile,
    cursors: { ...state.cursors },
    timelineHasOlder: state.timelineHasOlder,
    timelineHasNewer: state.timelineHasNewer,
    selectedIndex: state.selectedIndex,
    scroll: state.scroll,
    timelineCursorRow: state.timelineCursorRow,
    timelineCursorCol: state.timelineCursorCol,
    timelineCurswant: state.timelineCurswant,
    timelineVisualAnchor: { ...state.timelineVisualAnchor },
    timelineLineItemIndexes: [...state.timelineLineItemIndexes],
    timelineLinePlain: [...state.timelineLinePlain],
    lastArgs: [...state.lastArgs],
  };
}

function restoreTimelineSnapshot(snapshot: TimelineSnapshot): void {
  state.activeView = snapshot.activeView;
  state.title = snapshot.title;
  state.feedKind = snapshot.feedKind;
  state.items = [...snapshot.items];
  state.profile = snapshot.profile;
  state.cursors = { ...snapshot.cursors };
  state.timelineHasOlder = snapshot.timelineHasOlder;
  state.timelineHasNewer = snapshot.timelineHasNewer;
  state.timelineLoading = false;
  state.timelineLoadingOlder = false;
  state.timelineLoadingNewer = false;
  state.selectedIndex = snapshot.selectedIndex;
  state.scroll = snapshot.scroll;
  state.timelineCursorRow = snapshot.timelineCursorRow;
  state.timelineCursorCol = snapshot.timelineCursorCol;
  state.timelineCurswant = snapshot.timelineCurswant;
  state.timelineVisualAnchor = { ...snapshot.timelineVisualAnchor };
  state.timelineLineItemIndexes = [...snapshot.timelineLineItemIndexes];
  state.timelineLinePlain = [...snapshot.timelineLinePlain];
  state.lastArgs = [...snapshot.lastArgs];
  focusTimeline(state);
  setNotice(state, "", "muted");
  syncLoading();
  scheduleRender();
}

function goBackToSavedTimeline(): boolean {
  if (!timelineFocused() || !["thread", "profile"].includes(state.feedKind)) return false;
  const snapshot = state.timelineBackStack.pop();
  if (!snapshot) return false;
  restoreTimelineSnapshot(snapshot);
  return true;
}

async function openSelectedTweetAuthorProfile(): Promise<void> {
  const tweet = selectedTweet();
  const handle = tweet?.handle?.replace(/^@/, "") ?? "";
  if (!handle) {
    setNotice(state, "Select a tweet to open its author's profile.", "warning");
    return;
  }

  const currentProfileHandle = state.profile?.handle?.replace(/^@/, "").toLowerCase();
  if (state.feedKind !== "profile" || currentProfileHandle !== handle.toLowerCase()) {
    state.timelineBackStack.push(currentTimelineSnapshot());
  }
  await load(["tweets", handle, "-n", "35", "--profile"], `@${handle}`);
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
  if (state.panelFocus !== "content") return;
  const visibleRows = timelinePageSize();
  if (kind === "line") scrollTimelineViewportSticky(state, dir, visibleRows);
  else if (kind === "page") scrollTimelinePageWithCursor(state, dir, amount, visibleRows);
  else scrollTimelineWithCursor(state, dir, amount, visibleRows);
  afterTimelineCursorMove();
}

function toggleTimelineFocus(): void {
  if (state.panelFocus === "content" && state.contentFocus === "timeline") {
    focusPrompt(state);
    return;
  }
  focusTimeline(state);
  placeTimelineCursorAtVisibleBottom(state, timelinePageSize());
  scheduleRender();
}

function commandHistory(delta: number): boolean {
  if (state.commandHistory.length === 0 || state.editor.buffer.length > 0 && state.commandHistoryIndex === null) return false;
  const start = state.commandHistoryIndex ?? state.commandHistory.length;
  const next = Math.max(0, Math.min(state.commandHistory.length - 1, start + delta));
  state.commandHistoryIndex = next;
  resetEditor(state.editor, state.commandHistory[next] ?? "", "insert");
  updateAutocomplete(state);
  return true;
}

async function activateSelection(): Promise<void> {
  if (state.panelFocus === "sidebar") {
    const view = VIEWS[state.sidebarIndex];
    if (view?.id === "profile") {
      const handle = state.account?.handle;
      if (!handle) {
        setNotice(state, "Login first to open your profile.", "warning");
        return;
      }
      await load(["tweets", handle, "-n", "35", "--profile"], "Profile");
    } else if (view) await load(feedArgsForView(view.id), view.label);
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
  const openable = openableTargetAtTimelineCursor(state);
  if (openable) {
    if (openTargetDetached(openable)) {
      setNotice(state, `Opened ${openable}`, "success");
      return;
    }
    setNotice(state, `No opener found for ${openable}`, "warning");
    return;
  }
  const id = selectedTweetId();
  if (id) {
    const tweet = selectedTweet();
    if (state.feedKind !== "thread") state.timelineBackStack.push(currentTimelineSnapshot());
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
  state.quoteTargetId = null;
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
  state.replyTargetId = null;
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
    toggleTimelineFocus();
    return true;
  }
  if (state.panelFocus === "content") {
    const halfPage = Math.max(1, Math.floor(timelinePageSize() / 2));
    const fullPage = Math.max(1, timelinePageSize());
    if (key.type === "ctrl-e") { scrollFocusedTimeline("line", -1, 1); return true; }
    if (key.type === "ctrl-y") { scrollFocusedTimeline("line", 1, 1); return true; }
    if (key.type === "ctrl-d") { scrollFocusedTimeline("amount", -1, halfPage); return true; }
    if (key.type === "ctrl-u") { scrollFocusedTimeline("amount", 1, halfPage); return true; }
    if (key.type === "ctrl-f") { scrollFocusedTimeline("page", -1, fullPage); return true; }
    if (key.type === "ctrl-b") { scrollFocusedTimeline("page", 1, fullPage); return true; }
  }
  if (key.type === "ctrl-r") {
    void refresh();
    return true;
  }
  return false;
}

async function handlePromptKey(key: KeyEvent): Promise<void> {
  if (key.type === "tab") {
    if (state.autocomplete) cycleAutocomplete(state, 1);
    else tryPathComplete(state);
    scheduleRender();
    return;
  }
  if (key.type === "backtab") {
    if (state.autocomplete) cycleAutocomplete(state, -1);
    scheduleRender();
    return;
  }
  if (key.type === "escape" && state.autocomplete) acceptAutocomplete(state);

  const previousBuffer = state.editor.buffer;
  const previousCursor = state.editor.cursor;
  if (key.type === "up" && commandHistory(-1)) return;
  if (key.type === "down" && state.commandHistoryIndex !== null) {
    if (state.commandHistoryIndex >= state.commandHistory.length - 1) {
      state.commandHistoryIndex = null;
      resetEditor(state.editor, "", "insert");
      state.autocomplete = null;
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
  if (state.editor.buffer !== previousBuffer || state.editor.cursor !== previousCursor) updateAutocomplete(state);
}

async function handleKey(key: KeyEvent): Promise<void> {
  if (await handleGlobalKey(key)) return;
  if (state.panelFocus === "content" && state.contentFocus === "prompt") {
    await handlePromptKey(key);
    return;
  }

  if (state.panelFocus === "sidebar") {
    if (key.type === "escape") { focusPrompt(state); return; }
    if (key.type === "enter") { await activateSelection(); return; }
    if (key.type === "up") { sidebarMove(-1); return; }
    if (key.type === "down") { sidebarMove(1); return; }
    if (key.type !== "char" || !key.char) return;
    switch (key.char) {
      case "q": running = false; shutdown(); return;
      case "i": focusPrompt(state); return;
      case "/": setPrompt("/"); return;
      case "t": focusTimeline(state); return;
      case "j": sidebarMove(1); return;
      case "k": sidebarMove(-1); return;
      case "g": state.sidebarIndex = 0; return;
      case "G": state.sidebarIndex = VIEWS.length - 1; return;
    }
    return;
  }

  if (!timelineFocused()) return;

  if (handleTimelineVisualKey(state, key, afterTimelineCursorMove)) return;

  if (key.type === "escape") { focusPrompt(state); return; }
  if (key.type === "enter") { await activateSelection(); return; }
  if (key.type === "up") { moveTimelineCursorRows(state, -1); afterTimelineCursorMove(); return; }
  if (key.type === "down") { moveTimelineCursorRows(state, 1); afterTimelineCursorMove(); return; }
  if (key.type === "left") { moveTimelineCursorCols(state, -1); return; }
  if (key.type === "right") { moveTimelineCursorCols(state, 1); return; }
  if (key.type !== "char" || !key.char) return;
  switch (key.char) {
    case "q": running = false; shutdown(); return;
    case "i": focusPrompt(state); return;
    case "a": focusPrompt(state); resetEditor(state.editor, state.editor.buffer, "insert"); state.editor.cursor = state.editor.buffer.length; return;
    case "/": setPrompt("/"); return;
    case "s": focusSidebar(state); return;
    case "j": moveTimelineCursorRows(state, 1); afterTimelineCursorMove(); return;
    case "k": moveTimelineCursorRows(state, -1); afterTimelineCursorMove(); return;
    case "h": if (state.feedKind === "profile" && goBackToSavedTimeline()) return; moveTimelineCursorCols(state, -1); return;
    case "H": if (goBackToSavedTimeline()) return; break;
    case "l": moveTimelineCursorCols(state, 1); return;
    case "0": moveTimelineCursorLineStart(state); return;
    case "$": moveTimelineCursorLineEnd(state); return;
    case "g": setTimelineCursorToRow(state, 0); afterTimelineCursorMove(); return;
    case "G": setTimelineCursorToRow(state, Math.max(0, state.timelineLinePlain.length - 1)); afterTimelineCursorMove(); return;
    case "r": prepareReply(); return;
    case "Q": prepareQuote(); return;
    case "p": await openSelectedTweetAuthorProfile(); return;
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
  flushTwitterCacheSync();
  try { process.stdin.setRawMode(false); } catch {}
  process.stdin.pause();
  process.stdout.write(showCursor + enableAutowrap + disableBracketedPaste + disableKittyKeyboard + resetCursorColor + leaveAlt);
  setTimeout(() => process.exit(0), 0);
}

function start(): void {
  process.stdout.write(enterAlt + enableAutowrap + enableBracketedPaste + enableKittyKeyboard + (theme.cursorColor ? setCursorColor(theme.cursorColor) : ""));
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
  state.savedLogins = loadSavedLoginsSafe();
  render(state);
  void (async () => {
    await hydrateAccount();
    await load(["timeline", "-n", "35"], "Home");
  })();
}

start();
