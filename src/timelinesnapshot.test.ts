import { describe, expect, test } from "bun:test";
import { createInitialState, type TimelineSnapshot } from "./state";

describe("timeline snapshot shape", () => {
  test("stores the scroll/cursor fields needed to return from thread to timeline", () => {
    const state = createInitialState();
    state.activeView = "home";
    state.title = "Home";
    state.feedKind = "timeline";
    state.selectedIndex = 3;
    state.scroll = 42;
    state.timelineCursorRow = 44;
    state.timelineCursorCol = 7;
    state.timelineCurswant = 9;
    state.lastArgs = ["timeline", "-n", "35"];

    const snapshot: TimelineSnapshot = {
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
      timelineLineItemIndexes: [...state.timelineLineItemIndexes],
      timelineLinePlain: [...state.timelineLinePlain],
      lastArgs: [...state.lastArgs],
    };

    expect(snapshot.scroll).toBe(42);
    expect(snapshot.timelineCursorRow).toBe(44);
    expect(snapshot.timelineCursorCol).toBe(7);
    expect(snapshot.timelineCurswant).toBe(9);
    expect(snapshot.lastArgs).toEqual(["timeline", "-n", "35"]);
  });
});
