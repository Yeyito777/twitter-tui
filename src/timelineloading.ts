/**
 * Timeline loading state helpers adapted from record's timeline loading logic.
 */

import type { AppState } from "./state";
import type { FeedResult, TimelineItem } from "./types";

export function beginTimelineLoad(state: AppState): number {
  const requestId = ++state.timelineRequestId;
  state.timelineLoading = true;
  state.timelineLoadingOlder = false;
  state.timelineLoadingNewer = false;
  return requestId;
}

export function setTimelineFeed(state: AppState, feed: FeedResult, args: string[]): void {
  state.title = feed.title || feed.kind;
  state.feedKind = feed.kind;
  state.items = feed.items ?? [];
  state.profile = feed.profile ?? null;
  state.cursors = feed.cursors ?? {};
  state.timelineHasOlder = Boolean(feed.cursors?.bottom);
  state.timelineHasNewer = Boolean(feed.cursors?.top);
  state.timelineLoading = false;
  state.timelineLoadingOlder = false;
  state.timelineLoadingNewer = false;
  state.selectedIndex = 0;
  state.scroll = Number.MAX_SAFE_INTEGER;
  state.timelineCursorRow = 0;
  state.timelineCursorCol = 1;
  state.timelineCurswant = null;
  state.lastArgs = [...args];
  state.currentDmConversationId = feed.conversation_id ?? (feed.kind === "dm" ? state.currentDmConversationId : null);
}

export function shouldLoadOlderTimeline(state: AppState): boolean {
  if (state.timelineLoading || state.timelineLoadingOlder || state.timelineLoadingNewer || !state.timelineHasOlder || state.items.length === 0) return false;
  return state.timelineCursorRow >= Math.max(0, state.timelineLinePlain.length - 12);
}

export function shouldLoadNewerTimeline(state: AppState): boolean {
  if (state.timelineLoading || state.timelineLoadingOlder || state.timelineLoadingNewer || !state.timelineHasNewer || state.items.length === 0) return false;
  return state.timelineCursorRow <= 4;
}

export function startLoadingOlderTimeline(state: AppState): void {
  if (!shouldLoadOlderTimeline(state)) return;
  state.timelineLoadingOlder = true;
}

export function startLoadingNewerTimeline(state: AppState): void {
  if (!shouldLoadNewerTimeline(state)) return;
  state.timelineLoadingNewer = true;
}

export function finishLoadingOlderTimeline(state: AppState, feed: FeedResult | null): void {
  state.timelineLoadingOlder = false;
  if (!feed) return;
  const before = state.items.length;
  state.items = dedupeItems([...state.items, ...(feed.items ?? [])]);
  state.cursors.bottom = feed.cursors?.bottom;
  if (feed.cursors?.top) state.cursors.top = feed.cursors.top;
  state.timelineHasOlder = Boolean(feed.cursors?.bottom) && state.items.length > before;
  state.timelineHasNewer = Boolean(state.cursors.top);
}

export function finishLoadingNewerTimeline(state: AppState, feed: FeedResult | null): void {
  state.timelineLoadingNewer = false;
  if (!feed) return;
  const beforeRows = state.timelineLinePlain.length;
  const beforeItems = state.items.length;
  state.items = dedupeItems([...(feed.items ?? []), ...state.items]);
  state.cursors.top = feed.cursors?.top;
  if (feed.cursors?.bottom) state.cursors.bottom = feed.cursors.bottom;
  state.timelineHasNewer = Boolean(feed.cursors?.top) && state.items.length > beforeItems;
  state.timelineHasOlder = Boolean(state.cursors.bottom);
  const insertedItems = Math.max(0, state.items.length - beforeItems);
  if (insertedItems > 0) state.selectedIndex += insertedItems;
  // Preserve the visible window approximately until render can clamp exactly.
  state.scroll += Math.max(0, state.timelineLinePlain.length - beforeRows);
}

export function failTimelineLoad(state: AppState): void {
  state.timelineLoading = false;
  state.timelineLoadingOlder = false;
  state.timelineLoadingNewer = false;
}

export function cursorArgs(baseArgs: string[], cursor: string): string[] {
  const args = [...baseArgs];
  const cursorIndex = args.findIndex((arg) => arg === "-c" || arg === "--cursor");
  if (cursorIndex >= 0) {
    args.splice(cursorIndex, 2, "-c", cursor);
  } else {
    args.push("-c", cursor);
  }
  return args;
}

function itemKey(item: TimelineItem): string {
  if ("id" in item && typeof item.id === "string") return `${"type" in item ? item.type : "tweet"}:${item.id}`;
  if ("name" in item && typeof item.name === "string") return `trend:${item.name}`;
  return JSON.stringify(item);
}

function dedupeItems(items: TimelineItem[]): TimelineItem[] {
  const seen = new Set<string>();
  const out: TimelineItem[] = [];
  for (const item of items) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
