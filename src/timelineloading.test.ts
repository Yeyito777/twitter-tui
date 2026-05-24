import { describe, expect, test } from "bun:test";
import { createInitialState } from "./state";
import { beginTimelineLoad, cursorArgs, finishLoadingOlderTimeline, setTimelineFeed, shouldLoadNewerTimeline, shouldLoadOlderTimeline } from "./timelineloading";
import type { FeedResult } from "./types";

function feed(id: string, bottom?: string): FeedResult {
  return {
    ok: true,
    kind: "timeline",
    title: "Home",
    cursors: { bottom },
    items: [{ id, name: `Name ${id}`, handle: `h${id}`, text: `tweet ${id}`, created_at: "2026-05-24 00:00", url: `https://x.com/h/status/${id}` }],
  };
}

describe("timeline loading helpers", () => {
  test("initial timeline load marks loading and increments request", () => {
    const state = createInitialState();
    state.items = [feed("stale").items[0]];
    const request = beginTimelineLoad(state, "Loading Latest…", true);
    expect(request).toBe(1);
    expect(state.timelineLoading).toBe(true);
    expect(state.timelineLoadingLabel).toBe("Loading Latest…");
    expect(state.items).toEqual([]);
    expect(state.timelineLoadingOlder).toBe(false);
  });

  test("cursor args mirror record-style page loading by preserving base args", () => {
    expect(cursorArgs(["timeline", "-n", "35"], "CURSOR")).toEqual(["timeline", "-n", "35", "-c", "CURSOR"]);
    expect(cursorArgs(["search", "-c", "OLD", "bun"], "NEW")).toEqual(["search", "-c", "NEW", "bun"]);
  });

  test("older page append dedupes and keeps next cursor", () => {
    const state = createInitialState();
    setTimelineFeed(state, feed("1", "BOTTOM"), ["timeline"]);
    state.timelineLinePlain = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    state.timelineCursorRow = 19;
    expect(shouldLoadOlderTimeline(state)).toBe(true);
    finishLoadingOlderTimeline(state, { ...feed("2", "NEXT"), items: [...feed("1").items, ...feed("2").items] });
    expect(state.items.map((item) => "id" in item ? item.id : "")).toEqual(["1", "2"]);
    expect(state.cursors.bottom).toBe("NEXT");
  });

  test("twitter timeline never loads newer tweets upward", () => {
    const state = createInitialState();
    setTimelineFeed(state, { ...feed("1", "BOTTOM"), cursors: { top: "TOP", bottom: "BOTTOM" } }, ["timeline"]);
    state.timelineLinePlain = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    state.timelineCursorRow = 0;
    expect(state.timelineHasNewer).toBe(false);
    expect(shouldLoadNewerTimeline(state)).toBe(false);
  });
});
