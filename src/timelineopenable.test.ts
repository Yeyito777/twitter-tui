import { describe, expect, test } from "bun:test";
import { createInitialState } from "./state";
import { openableTargetAtTimelineCursor } from "./timelineopenable";

describe("timeline openables", () => {
  test("returns link under timeline cursor", () => {
    const state = createInitialState();
    state.timelineLinePlain = [" see https://example.com/path now"];
    state.timelineLineItemIndexes = [0];
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 8;
    state.items = [{ id: "1", name: "A", handle: "a", text: "see https://example.com/path now", created_at: "", url: "https://x.com/a/status/1" }];
    expect(openableTargetAtTimelineCursor(state)).toBe("https://example.com/path");
  });

  test("does not fall back to selected tweet URL so Enter can open thread", () => {
    const state = createInitialState();
    state.items = [{ id: "1", name: "A", handle: "a", text: "no links", created_at: "", url: "https://x.com/a/status/1" }];
    state.selectedIndex = 0;
    expect(openableTargetAtTimelineCursor(state)).toBeNull();
  });
});
