import { describe, expect, test } from "bun:test";
import { createInitialState } from "./state";
import { moveTimelineCursorCols, moveTimelineCursorRows } from "./timelinecursor";

describe("timeline curswant", () => {
  test("j/k preserve preferred column across short timeline lines", () => {
    const state = createInitialState();
    state.timelineLinePlain = [" abcdef", " x", " 123456789"];
    state.timelineLineItemIndexes = [0, 0, 0];
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 6;

    moveTimelineCursorRows(state, 1);
    expect(state.timelineCursorRow).toBe(1);
    expect(state.timelineCursorCol).toBe(1); // clamped to the short line's content

    moveTimelineCursorRows(state, 1);
    expect(state.timelineCursorRow).toBe(2);
    expect(state.timelineCursorCol).toBe(6);
    expect(state.timelineCurswant).toBe(6);
  });

  test("horizontal timeline motion resets preferred column", () => {
    const state = createInitialState();
    state.timelineLinePlain = [" abcdef", " x", " 123456789"];
    state.timelineLineItemIndexes = [0, 0, 0];
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 6;

    moveTimelineCursorRows(state, 1);
    moveTimelineCursorRows(state, 1);
    expect(state.timelineCursorCol).toBe(6);

    moveTimelineCursorCols(state, -1);
    expect(state.timelineCursorCol).toBe(5);
    expect(state.timelineCurswant).toBeNull();

    moveTimelineCursorRows(state, -1);
    expect(state.timelineCursorRow).toBe(1);
    expect(state.timelineCursorCol).toBe(1);
    moveTimelineCursorRows(state, 1);
    expect(state.timelineCursorRow).toBe(2);
    expect(state.timelineCursorCol).toBe(5);
  });
});
