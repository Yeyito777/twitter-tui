import { describe, expect, test } from "bun:test";
import { createInitialState } from "./state";
import { moveTimelineCursorCols, moveTimelineCursorRows, placeTimelineCursorAtVisibleBottom, scrollTimelinePageWithCursor, scrollTimelineViewportSticky, scrollTimelineWithCursor } from "./timelinecursor";
import { render } from "./render";

describe("timeline curswant", () => {
  test("blank tweet lines render cursor at the left content cell", () => {
    const state = createInitialState();
    state.timelineLinePlain = [" first", "", "   ", " last"];
    state.timelineLineItemIndexes = [0, 0, 0, 0];
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 20;

    moveTimelineCursorRows(state, 1);
    expect(state.timelineCursorRow).toBe(1);
    expect(state.timelineCursorCol).toBe(1);

    moveTimelineCursorRows(state, 1);
    expect(state.timelineCursorRow).toBe(2);
    expect(state.timelineCursorCol).toBe(1);
  });

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

describe("timeline record-style ctrl scrolling", () => {
  function scrollingState() {
    const state = createInitialState();
    state.timelineLinePlain = Array.from({ length: 20 }, (_, index) => ` line ${index}`);
    state.timelineLineItemIndexes = Array.from({ length: 20 }, (_, index) => index);
    state.items = Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: "n", handle: "h", text: "t", created_at: "", url: "" }));
    state.timelineCursorRow = 5;
    state.timelineCursorCol = 3;
    state.scroll = 4;
    return state;
  }

  test("Ctrl+E/Y sticky viewport scroll keeps cursor visible like record", () => {
    const state = scrollingState();
    scrollTimelineViewportSticky(state, -1, 5); // Ctrl+E, down/newer
    expect(state.scroll).toBe(5);
    expect(state.timelineCursorRow).toBe(5);
    scrollTimelineViewportSticky(state, 1, 5); // Ctrl+Y, up/older
    expect(state.scroll).toBe(4);
    expect(state.timelineCursorRow).toBe(5);
  });

  test("Ctrl+D/U move cursor and viewport by amount like record", () => {
    const state = scrollingState();
    scrollTimelineWithCursor(state, -1, 3, 5); // Ctrl+D
    expect(state.scroll).toBe(7);
    expect(state.timelineCursorRow).toBe(8);
    expect(state.selectedIndex).toBe(8);
    scrollTimelineWithCursor(state, 1, 3, 5); // Ctrl+U
    expect(state.scroll).toBe(4);
    expect(state.timelineCursorRow).toBe(5);
  });

  test("Ctrl+F/B page viewport first and clamp cursor into view like record", () => {
    const state = scrollingState();
    scrollTimelinePageWithCursor(state, -1, 5, 5); // Ctrl+F
    expect(state.scroll).toBe(9);
    expect(state.timelineCursorRow).toBe(9);
    scrollTimelinePageWithCursor(state, 1, 5, 5); // Ctrl+B
    expect(state.scroll).toBe(4);
    expect(state.timelineCursorRow).toBe(8);
  });

  test("render keeps line-centered scroll instead of snapping viewport to selected tweet card", () => {
    const state = createInitialState();
    state.cols = 120;
    state.rows = 20;
    state.panelFocus = "content";
    state.contentFocus = "timeline";
    state.items = [
      { id: "1", name: "A", handle: "a", text: Array.from({ length: 16 }, (_, i) => `line ${i}`).join("\n"), created_at: "", url: "" },
      { id: "2", name: "B", handle: "b", text: "second", created_at: "", url: "" },
    ];
    state.selectedIndex = 0;
    state.timelineCursorRow = 8;
    state.timelineCursorCol = 1;
    state.scroll = 8;

    const originalWrite = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      render(state);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(state.scroll).toBe(8);
    expect(state.timelineCursorRow).toBe(8);
  });

  test("Ctrl+N timeline focus places cursor at visible bottom like record history", () => {
    const state = createInitialState();
    state.timelineLinePlain = Array.from({ length: 30 }, (_, index) => ` line ${index}`);
    state.timelineLineItemIndexes = Array.from({ length: 30 }, (_, index) => index);
    state.items = Array.from({ length: 30 }, (_, index) => ({ id: String(index), name: "n", handle: "h", text: "t", created_at: "", url: "" }));
    state.scroll = 10;

    placeTimelineCursorAtVisibleBottom(state, 8);

    expect(state.timelineCursorRow).toBe(17);
    expect(state.timelineCursorCol).toBe(1);
    expect(state.selectedIndex).toBe(17);
  });
});
