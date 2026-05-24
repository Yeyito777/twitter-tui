import { displayCursor, getInputLines, getVisualRange, MAX_PROMPT_ROWS, PROMPT_PREFIX_WIDTH, wrappedLineOffsets } from "./editor";
import { renderLineWithCursor } from "./historyrender";
import { LOADING_FRAMES, loadingLabel } from "./loading";
import { focusLabel, VIEWS, type AppState } from "./state";
import { renderStatusLine } from "./statusline";
import { syncTimelineCursorToSelection, stripTimelineAnsi } from "./timelinecursor";
import { applyTimelineVisualSelection } from "./timelinevisual";
import { isDmConversation, isDmMessage, isNotification, isTrend, isTweet, type TimelineItem, type TweetItem } from "./types";
import { authorColor, theme } from "./theme";
import { applyLineBg, clearLine, cursorBar, cursorBlock, cursorUnderline, hideCursor, moveTo, showCursor } from "./terminal";
import { padRightToWidth, padVisibleRightToWidth, sliceByWidth, termWidth, truncateToWidth, visibleLength } from "./textwidth";

const SIDEBAR_WIDTH = 28;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function sanitize(text: string): string {
  return text.replace(/\r/g, "").replace(/\t/g, "  ");
}

function highlightPromptSelection(
  text: string,
  wrappedLineIdx: number,
  selectionStart: number,
  selectionEndExclusive: number,
  offsets: number[],
): string {
  if (wrappedLineIdx >= offsets.length) return `${theme.text}${text}${theme.reset}`;
  const lineStart = offsets[wrappedLineIdx];
  const lineEndExclusive = lineStart + text.length;
  const overlapStart = Math.max(selectionStart, lineStart);
  const overlapEndExclusive = Math.min(selectionEndExclusive, lineEndExclusive);
  if (overlapStart >= overlapEndExclusive) return `${theme.text}${text}${theme.reset}`;
  const relStart = overlapStart - lineStart;
  const relEnd = overlapEndExclusive - lineStart;
  return `${theme.text}${text.slice(0, relStart)}`
    + `${theme.selectionBg}${theme.text}${text.slice(relStart, relEnd)}${theme.reset}${theme.text}`
    + `${text.slice(relEnd)}${theme.reset}`;
}

function wrapPlain(text: string, width: number): string[] {
  const out: string[] = [];
  const paragraphs = sanitize(text || "").split("\n");
  for (const paragraph of paragraphs) {
    let remaining = paragraph;
    if (!remaining) {
      out.push("");
      continue;
    }
    while (termWidth(remaining) > width) {
      let [taken, rest] = sliceByWidth(remaining, width);
      const breakAt = Math.max(taken.lastIndexOf(" "), taken.lastIndexOf("/"));
      if (breakAt > Math.floor(width * 0.45)) {
        rest = taken.slice(breakAt + 1) + rest;
        taken = taken.slice(0, breakAt);
      }
      out.push(taken.trimEnd());
      remaining = rest.trimStart();
    }
    out.push(remaining);
  }
  return out;
}

function line(text: string, width: number, bg = ""): string {
  const padded = padVisibleRightToWidth(text, width);
  return bg ? applyLineBg(padded, bg) : padded;
}

function compact(n: unknown): string {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return String(n ?? "0");
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function age(created: string): string {
  if (!created) return "";
  const date = new Date(created.replace(" ", "T") + (created.includes("Z") ? "" : ":00Z"));
  if (Number.isNaN(date.getTime())) return created;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return created.slice(0, 10);
}

function tweetSubject(tweet: TweetItem): TweetItem {
  return tweet.is_retweet && tweet.retweeted ? tweet.retweeted : tweet;
}

export function displayTweetText(tweet: TweetItem): string {
  const text = decodeHtmlEntities(tweet.text || "");
  if (!tweet.is_reply || !tweet.in_reply_to) return text;
  const escaped = tweet.in_reply_to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^@${escaped}\\s+`, "i"), "");
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    });
}

export function renderTweetCard(tweet: TweetItem, width: number, selected: boolean): string[] {
  const subject = tweetSubject(tweet);
  const bg = selected ? theme.historyLineBg : "";
  const color = authorColor(subject.handle || subject.id);
  const inner = Math.max(8, width - 2);
  const out: string[] = [];
  const rtPrefix = tweet.is_retweet && tweet.retweeted ? `${theme.dim}🔁 @${tweet.handle} reposted${theme.reset} ` : "";
  const reply = subject.is_reply && subject.in_reply_to ? `${theme.dim} ↩ @${subject.in_reply_to}${theme.reset}` : "";
  const name = `${color}${subject.name}${theme.reset} ${theme.muted}@${subject.handle}${theme.reset}`;
  const meta = `${theme.dim}${age(subject.created_at)}${reply}${theme.reset}`;
  out.push(line(` ${rtPrefix}${name} ${meta}`, width, bg));
  for (const textLine of wrapPlain(displayTweetText(subject), inner)) {
    out.push(line(` ${theme.text}${textLine}${theme.reset}`, width, bg));
  }
  if (subject.quoted) {
    const quoted = subject.quoted;
    out.push(line(` ${theme.dim}▎ quote @${quoted.handle}${theme.reset}`, width, bg));
    for (const qline of wrapPlain(displayTweetText(quoted), Math.max(4, inner - 4)).slice(0, 4)) {
      out.push(line(` ${theme.dim}▎ ${truncateToWidth(qline, inner - 2)}${theme.reset}`, width, bg));
    }
    out.push(line(` ${theme.dim}▎ ♥ ${compact(quoted.likes)}  ↻ ${compact(quoted.retweets)}${theme.reset}`, width, bg));
  }
  for (const media of subject.media ?? []) {
    const label = `${theme.tool}📎 ${media.type}${theme.reset} ${theme.dim}${media.url || media.expanded_url || "media"}${theme.reset}`;
    out.push(line(` ${truncateToWidth(label, inner)}`, width, bg));
  }
  const stats = `${theme.muted}♥${theme.reset} ${compact(subject.likes)}  ${theme.muted}↻${theme.reset} ${compact(subject.retweets)}  ${theme.muted}💬${theme.reset} ${compact(subject.replies)}  ${theme.muted}👁${theme.reset} ${compact(subject.views)}`;
  out.push(line(` ${stats}`, width, bg));
  return out;
}

function renderItemCard(item: TimelineItem, width: number, selected: boolean): string[] {
  const bg = selected ? theme.historyLineBg : "";
  const border = selected ? theme.accent : theme.borderUnfocused;
  const inner = Math.max(8, width - 4);
  if (isTweet(item)) return renderTweetCard(item, width, selected);
  if (isNotification(item)) {
    const out = [line(`${border}╭─${theme.reset} ${theme.warning}${item.icon}${theme.reset} ${theme.text}${item.message}${theme.reset} ${theme.dim}${item.created_at ?? ""}${theme.reset}`, width, bg)];
    if (item.url) out.push(line(`${border}╰─${theme.reset} ${theme.dim}${truncateToWidth(item.url, inner)}${theme.reset}`, width, bg));
    else out.push(line(`${border}╰─${theme.reset}`, width, bg));
    return out;
  }
  if (isTrend(item)) {
    return [
      line(`${border}╭─${theme.reset} ${theme.accent}${item.rank ?? ""}. ${item.name}${theme.reset} ${theme.dim}${item.domain ?? ""}${theme.reset}`, width, bg),
      ...wrapPlain(item.description ?? "", inner).map((part) => line(`${border}│${theme.reset} ${part}`, width, bg)),
      line(`${border}╰─${theme.reset}`, width, bg),
    ];
  }
  if (isDmConversation(item)) {
    const names = item.participants.map((p) => `${p.name} @${p.handle}`).join(" & ");
    return [
      line(`${border}╭─${theme.reset} ${theme.accent}✉${theme.reset} ${truncateToWidth(names, inner)} ${theme.dim}${item.last_time}${theme.reset}`, width, bg),
      ...wrapPlain(`@${item.last_sender}: ${item.last_message}`, inner).map((part) => line(`${border}│${theme.reset} ${part}`, width, bg)),
      line(`${border}╰─${theme.reset} ${theme.dim}${item.id}${theme.reset}`, width, bg),
    ];
  }
  if (isDmMessage(item)) {
    const color = authorColor(item.sender.handle);
    return [
      line(`${border}╭─${theme.reset} ${color}@${item.sender.handle}${theme.reset} ${theme.dim}${item.time}${theme.reset}`, width, bg),
      ...wrapPlain(item.text, inner).map((part) => line(`${border}│${theme.reset} ${part}`, width, bg)),
      line(`${border}╰─${theme.reset}`, width, bg),
    ];
  }
  return [line(`${border}╭─${theme.reset} ${JSON.stringify(item)}`, width, bg), line(`${border}╰─${theme.reset}`, width, bg)];
}

function renderProfile(state: AppState, width: number): string[] {
  const profile = state.profile;
  if (!profile) return [];
  const out: string[] = [];
  out.push(`${theme.accent}╭─${theme.reset} ${theme.bold}${profile.name}${theme.boldOff} ${theme.muted}@${profile.handle}${theme.reset}${profile.verified ? ` ${theme.success}✓${theme.reset}` : ""}`);
  for (const bio of wrapPlain(profile.bio, Math.max(8, width - 4))) out.push(`${theme.accent}│${theme.reset} ${bio}`);
  if (profile.location) out.push(`${theme.accent}│${theme.reset} 📍 ${profile.location}`);
  out.push(`${theme.accent}│${theme.reset} ${compact(profile.followers)} followers · ${compact(profile.following)} following · ${compact(profile.tweets)} tweets`);
  out.push(`${theme.accent}╰─${theme.reset} ${theme.dim}${profile.url}${theme.reset}`);
  return out.map((l) => line(l, width));
}

function renderSidebar(state: AppState, width: number, height: number, focused: boolean): string[] {
  const borderFg = focused ? theme.borderFocused : theme.borderUnfocused;
  const borderBg = theme.appBg ?? "";
  const innerWidth = Math.max(0, width - 1);
  const out: string[] = [];

  const push = (body: string, rowBg = theme.sidebarBg): void => {
    out.push(`${rowBg}${body}${theme.reset}${borderBg}${borderFg}│${theme.reset}`);
  };

  const header = " Twitter";
  push(`${theme.text}${theme.bold}${padRightToWidth(header, innerWidth)}${theme.boldOff}`);
  out.push(`${theme.sidebarBg}${borderFg}${"─".repeat(innerWidth)}${borderBg}┤${theme.reset}`);

  VIEWS.forEach((view, index) => {
    const selected = state.sidebarIndex === index && focused;
    const active = state.activeView === view.id;
    const bg = selected ? theme.sidebarSelBg : theme.sidebarBg;
    const fg = selected || active ? theme.text : theme.muted;
    const selectPrefix = selected ? "▸ " : "  ";
    const marker = `${view.icon} `;
    const rawLabel = `${marker}${view.label}`;
    const labelWidth = Math.max(0, innerWidth - termWidth(selectPrefix));
    const title = padRightToWidth(rawLabel, labelWidth);
    const text = active ? `${theme.bold}${title}${theme.boldOff}` : title;
    push(`${fg}${selectPrefix}${text}`, bg);
  });

  while (out.length < height) {
    out.push(`${theme.sidebarBg}${" ".repeat(innerWidth)}${theme.reset}${borderBg}${borderFg}│${theme.reset}`);
  }
  return out.slice(0, height);
}

function renderTopbar(state: AppState, width: number): string {
  const spinner = state.notice.loading ? `${LOADING_FRAMES[state.loadingFrameIndex % LOADING_FRAMES.length]} ` : "";
  const descriptor = `${state.title} ${theme.dim}(${state.selectedIndex + Math.min(1, state.items.length)}/${state.items.length})${theme.reset}`;
  const text = ` 𝕏 Twitter [${focusLabel(state)}] — ${spinner}${descriptor}`;
  const padded = padVisibleRightToWidth(`${theme.text}${theme.bold}${text}${theme.boldOff}`, width)
    .replaceAll(theme.reset, `${theme.reset}${theme.topbarBg}`);
  return `${theme.topbarBg}${padded}${theme.reset}`;
}

export function render(state: AppState): void {
  const cols = Math.max(40, state.cols);
  const rows = Math.max(10, state.rows);
  const sidebarFocused = state.panelFocus === "sidebar";
  const timelineFocused = state.panelFocus === "content" && state.contentFocus === "timeline";
  const promptFocused = state.panelFocus === "content" && state.contentFocus === "prompt";
  const sidebarW = state.sidebarOpen ? Math.min(SIDEBAR_WIDTH, cols - 20) : 0;
  const mainW = Math.max(1, cols - sidebarW);
  const status = renderStatusLine(state, mainW);
  const statusHeight = status.height;
  const promptInner = Math.max(1, mainW - PROMPT_PREFIX_WIDTH - 2);
  const input = getInputLines(state.editor.buffer, displayCursor(state.editor), promptInner, Math.max(1, Math.min(MAX_PROMPT_ROWS, rows - 6 - statusHeight)), state.editor.scroll);
  state.editor.scroll = input.scrollOffset;
  const promptRows = Math.max(1, input.lines.length);
  const bodyTop = 3;
  const statusTop = rows - statusHeight + 1;
  const promptBottomSeparatorRow = statusHeight > 0 ? statusTop - 1 : rows + 1;
  const promptTop = Math.max(bodyTop + 1, promptBottomSeparatorRow - promptRows);
  const promptSeparatorRow = promptTop - 1;
  const bodyHeight = Math.max(1, promptSeparatorRow - bodyTop);
  const out: string[] = [hideCursor];
  const bg = theme.appBg ?? "";

  const sidebar = state.sidebarOpen ? renderSidebar(state, sidebarW, rows, sidebarFocused) : [];
  for (let r = 1; r <= rows; r++) out.push(moveTo(r, 1) + (bg ? applyLineBg("", bg) : clearLine));
  if (state.sidebarOpen) {
    for (let r = 1; r <= rows; r++) out.push(moveTo(r, 1) + sidebar[r - 1]);
  }

  const mainCol = sidebarW + 1;
  out.push(moveTo(1, mainCol) + renderTopbar(state, mainW));
  out.push(moveTo(2, mainCol) + `${timelineFocused ? theme.accent : theme.borderUnfocused}${"─".repeat(mainW)}${theme.reset}`);
  const timelineInVisual = timelineFocused && (state.editor.mode === "visual" || state.editor.mode === "visual-line");

  const cards: string[][] = [];
  if (state.profile) cards.push(renderProfile(state, mainW));
  for (let i = 0; i < state.items.length; i++) cards.push(renderItemCard(state.items[i], mainW, i === state.selectedIndex && timelineFocused && !timelineInVisual));
  const threadLoading = state.timelineLoading && state.feedKind === "thread";
  if (state.timelineLoading && cards.length === 0) {
    cards.push([
      line(`${theme.muted}${truncateToWidth(loadingLabel(threadLoading ? "Loading Replies…" : state.timelineLoadingLabel, state.loadingFrameIndex), mainW)}${theme.reset}`, mainW),
    ]);
  } else if (cards.length === 0) {
    cards.push([
      line(`${theme.dim}No items yet.${theme.reset}`, mainW),
      line(`${theme.dim}${state.notice.loading ? "Fetching timeline…" : "Ready."}${theme.reset}`, mainW),
    ]);
  }
  const flat: string[] = [];
  const starts: number[] = [];
  const lineItemIndexes: number[] = [];
  if (state.timelineLoading && state.items.length > 0 && !threadLoading) {
    flat.push(`${theme.muted}${truncateToWidth(loadingLabel(state.timelineLoadingLabel, state.loadingFrameIndex), mainW)}${theme.reset}`, "");
    lineItemIndexes.push(-1, -1);
  }
  for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
    const card = cards[cardIndex];
    starts.push(flat.length);
    const itemIndex = state.profile ? cardIndex - 1 : cardIndex;
    for (const row of card) {
      flat.push(row);
      lineItemIndexes.push(itemIndex);
    }
    flat.push("");
    lineItemIndexes.push(itemIndex);
  }
  if (state.timelineLoadingOlder) {
    flat.push(`${theme.muted}${truncateToWidth(loadingLabel("Loading More Tweets…", state.loadingFrameIndex), mainW)}${theme.reset}`);
    lineItemIndexes.push(-1);
  }
  if (threadLoading && state.items.length > 0) {
    flat.push(`${theme.muted}${truncateToWidth(loadingLabel("Loading Replies…", state.loadingFrameIndex), mainW)}${theme.reset}`);
    lineItemIndexes.push(-1);
  }
  const selectedCardIndex = state.profile ? state.selectedIndex + 1 : state.selectedIndex;
  const selectedStart = starts[selectedCardIndex] ?? 0;
  const selectedEnd = (starts[selectedCardIndex] ?? 0) + (cards[selectedCardIndex]?.length ?? 1);
  state.timelineLineItemIndexes = lineItemIndexes;
  state.timelineLinePlain = flat.map(stripTimelineAnsi);
  syncTimelineCursorToSelection(state, state.profile ? starts.slice(1) : starts);
  if (selectedStart < state.scroll) state.scroll = selectedStart;
  if (selectedEnd > state.scroll + bodyHeight) state.scroll = Math.max(0, selectedEnd - bodyHeight);
  if (state.timelineCursorRow < state.scroll) state.scroll = state.timelineCursorRow;
  if (state.timelineCursorRow >= state.scroll + bodyHeight) state.scroll = Math.max(0, state.timelineCursorRow - bodyHeight + 1);
  state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, flat.length - bodyHeight)));

  for (let r = 0; r < bodyHeight; r++) {
    const rowIndex = state.scroll + r;
    let content = flat[rowIndex] ?? "";
    if (timelineFocused) content = applyTimelineVisualSelection(state, content, rowIndex);
    if (timelineFocused && rowIndex === state.timelineCursorRow) content = renderLineWithCursor(content, state.timelineCursorCol);
    out.push(moveTo(bodyTop + r, mainCol) + line(content, mainW, bg));
  }
  out.push(moveTo(promptSeparatorRow, mainCol) + `${promptFocused ? theme.accent : theme.borderUnfocused}${"─".repeat(mainW)}${theme.reset}`);

  const mode = state.editor.mode === "insert" ? "I" : state.editor.mode === "normal" ? "N" : "V";
  const modeColor = state.editor.mode === "insert" ? theme.vimInsert : state.editor.mode === "normal" ? theme.vimNormal : theme.vimVisual;
  const promptColor = promptFocused ? theme.accent : theme.borderUnfocused;
  const offsets = wrappedLineOffsets(state.editor.buffer, promptInner);
  const promptInVisual = promptFocused && (state.editor.mode === "visual" || state.editor.mode === "visual-line");
  const promptSelection = promptInVisual ? getVisualRange(state.editor.buffer, state.editor.visualAnchor, state.editor.cursor, state.editor.mode) : null;
  let cursorRow = promptTop;
  let cursorCol = mainCol + PROMPT_PREFIX_WIDTH + input.cursorCol;
  for (let i = 0; i < promptRows; i++) {
    const isFirst = i === 0 && !input.isNewLine[i];
    const promptGlyph = isFirst ? ">" : "+";
    const prefix = isFirst
      ? `${modeColor}${mode}${theme.reset} ${promptColor}${promptGlyph}${theme.reset} `
      : `  ${promptColor}${promptGlyph}${theme.reset} `;
    const text = input.lines[i] ?? "";
    const lineContent = promptSelection
      ? highlightPromptSelection(text, input.scrollOffset + i, promptSelection.start, promptSelection.endExclusive, offsets)
      : `${theme.text}${text}${theme.reset}`;
    out.push(moveTo(promptTop + i, mainCol) + line(`${prefix}${lineContent}`, mainW, bg));
    if (i === input.cursorLine) {
      cursorRow = promptTop + i;
      cursorCol = mainCol + PROMPT_PREFIX_WIDTH + input.cursorCol;
    }
  }
  if (statusHeight > 0) {
    out.push(moveTo(promptBottomSeparatorRow, mainCol) + `${promptFocused ? theme.accent : theme.borderUnfocused}${"─".repeat(mainW)}${theme.reset}`);
    for (let i = 0; i < statusHeight; i++) {
      out.push(moveTo(statusTop + i, mainCol) + line(status.lines[i] ?? "", mainW, bg));
    }
  }
  if (timelineFocused && flat.length > 0) {
    const visibleRow = state.timelineCursorRow - state.scroll;
    if (visibleRow >= 0 && visibleRow < bodyHeight) {
      const historyCursorRow = bodyTop + visibleRow;
      const historyCursorCol = Math.min(cols, mainCol + 1 + Math.max(0, state.timelineCursorCol));
      out.push(moveTo(historyCursorRow, historyCursorCol));
      out.push(hideCursor);
    } else {
      out.push(hideCursor);
    }
  } else {
    out.push(moveTo(cursorRow, Math.max(1, Math.min(cols, cursorCol))));
    if (promptFocused) {
      out.push(
        state.editor.mode === "insert"
          ? cursorBar
          : (state.editor.pendingOperator || state.editor.pendingReplace)
            ? cursorUnderline
            : cursorBlock,
      );
      out.push(showCursor);
    } else {
      out.push(hideCursor);
    }
  }
  process.stdout.write(out.join(""));
}
