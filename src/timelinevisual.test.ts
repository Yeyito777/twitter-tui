import { describe, expect, test } from "bun:test";
import { createInitialState } from "./state";
import { getTimelineVisualSelection, handleTimelineVisualKey, lineSelectionRangeForRow } from "./timelinevisual";
import { theme } from "./theme";
import { renderLineWithSelection } from "./historyrender";

describe("timeline visual mode", () => {
  test("normal timeline action keys are not swallowed by visual handler", () => {
    const state = createInitialState();
    state.timelineLinePlain = [" hello world"];
    state.timelineLineItemIndexes = [0];
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 1;

    expect(handleTimelineVisualKey(state, { type: "char", char: "b" })).toBe(false);
    expect(handleTimelineVisualKey(state, { type: "char", char: "r" })).toBe(false);
    expect(handleTimelineVisualKey(state, { type: "char", char: "w" })).toBe(false);
    expect(state.timelineCursorCol).toBe(1);
  });

  test("v enters character visual mode and y exits after yanking", () => {
    const state = createInitialState();
    state.timelineLinePlain = [" hello world"];
    state.timelineLineItemIndexes = [0];
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 1;

    expect(handleTimelineVisualKey(state, { type: "char", char: "v" })).toBe(true);
    expect(state.editor.mode).toBe("visual");
    handleTimelineVisualKey(state, { type: "char", char: "l" });
    handleTimelineVisualKey(state, { type: "char", char: "l" });
    expect(getTimelineVisualSelection(state)).toBe("hel");
    expect(handleTimelineVisualKey(state, { type: "char", char: "y" })).toBe(true);
    expect(state.editor.mode).toBe("normal");
  });

  test("V enters line visual mode", () => {
    const state = createInitialState();
    state.timelineLinePlain = [" first", " second"];
    state.timelineLineItemIndexes = [0, 0];
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 1;
    handleTimelineVisualKey(state, { type: "char", char: "V" });
    handleTimelineVisualKey(state, { type: "char", char: "j" });
    expect(state.editor.mode).toBe("visual-line");
    expect(getTimelineVisualSelection(state)).toBe(" first\n second");
  });

  test("visual-line selection is bounded to rendered line content, not the whole padded tweet row", () => {
    const state = createInitialState();
    state.editor.mode = "visual-line";
    state.timelineLinePlain = [" first      ", " second     "];
    state.timelineLineItemIndexes = [0, 0];
    state.timelineVisualAnchor = { row: 0, col: 1 };
    state.timelineCursorRow = 1;
    state.timelineCursorCol = 1;

    expect(lineSelectionRangeForRow(state, 0)).toEqual({ start: 1, end: 5 });
    expect(lineSelectionRangeForRow(state, 1)).toEqual({ start: 1, end: 6 });
  });

  test("visual mode owns movement keys while active", () => {
    const state = createInitialState();
    state.timelineLinePlain = [" hello", " world"];
    state.timelineLineItemIndexes = [0, 0];
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 1;
    handleTimelineVisualKey(state, { type: "char", char: "v" });

    expect(handleTimelineVisualKey(state, { type: "char", char: "j" })).toBe(true);
    expect(state.timelineCursorRow).toBe(1);
    expect(state.editor.mode).toBe("visual");
  });

  test("selection renderer applies selection background", () => {
    expect(renderLineWithSelection(" abc", 1, 2)).toContain(theme.selectionBg);
  });
});
