/**
 * Timeline cursor behavior copied/adapted from record's chat-history cursor.
 *
 * The timeline keeps a real cursor over rendered feed lines. Moving the cursor
 * by line/char updates the selected tweet to the item under the cursor, while
 * card selection changes snap the cursor back to that card's first rendered row.
 */

import type { AppState } from "./state";
import {
  scrollByAmountWithCursorInViewport,
  scrollLineWithStickyCursorInViewport,
  scrollPageWithCursorInViewport,
} from "./vimscroll";

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\]8;[^;]*;[^\x1b]*\x1b\\/g;

export function stripTimelineAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function timelineContentBounds(plain: string): { start: number; end: number } {
  if (plain.trim().length === 0) {
    return { start: 1, end: 1 };
  }
  let start = 0;
  while (start < plain.length && plain[start] === " ") start++;
  let end = plain.length - 1;
  while (end > start && plain[end] === " ") end--;
  if (start >= plain.length) {
    const pos = Math.max(0, plain.length);
    return { start: pos, end: pos };
  }
  return { start, end };
}

export function clampTimelineCol(col: number, lines: string[], row: number): number {
  const plain = lines[row] ?? "";
  const { start, end } = timelineContentBounds(plain);
  return Math.max(start, Math.min(col, end));
}

function nearestSelectableTimelineRow(state: AppState, row: number, preferredDir = 0): number {
  const lines = state.timelineLinePlain;
  if (lines.length === 0) return 0;
  const indexes = state.timelineLineItemIndexes;
  if (indexes.length !== lines.length) return row;
  const isSelectable = (candidate: number): boolean => {
    const itemIndex = indexes[candidate];
    return itemIndex !== undefined && itemIndex >= 0 && itemIndex < state.items.length;
  };
  if (isSelectable(row)) return row;

  const dirs = preferredDir > 0 ? [1, -1] : preferredDir < 0 ? [-1, 1] : [1, -1];
  for (let distance = 1; distance < lines.length; distance++) {
    for (const dir of dirs) {
      const candidate = row + distance * dir;
      if (candidate >= 0 && candidate < lines.length && isSelectable(candidate)) return candidate;
    }
  }
  return row;
}

export function clampTimelineCursor(state: AppState, preferredDir = 0): void {
  const lines = state.timelineLinePlain;
  if (lines.length === 0) {
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 0;
    state.timelineCurswant = null;
    return;
  }
  state.timelineCursorRow = Math.max(0, Math.min(state.timelineCursorRow, lines.length - 1));
  state.timelineCursorRow = nearestSelectableTimelineRow(state, state.timelineCursorRow, preferredDir);
  state.timelineCursorCol = clampTimelineCol(state.timelineCursorCol, lines, state.timelineCursorRow);
}

export function setTimelineCursorToRow(state: AppState, row: number): void {
  const previousRow = state.timelineCursorRow;
  state.timelineCursorRow = Math.max(0, Math.min(row, Math.max(0, state.timelineLinePlain.length - 1)));
  clampTimelineCursor(state, Math.sign(row - previousRow));
  state.timelineCurswant = null;
  syncTimelineSelectionToCursor(state);
}

export function moveTimelineCursorRows(state: AppState, delta: number): void {
  if (state.timelineLinePlain.length === 0) return;
  const desiredCol = state.timelineCurswant ?? state.timelineCursorCol;
  const targetRow = Math.max(0, Math.min(state.timelineCursorRow + delta, state.timelineLinePlain.length - 1));
  state.timelineCursorRow = targetRow;
  clampTimelineCursor(state, Math.sign(delta));
  state.timelineCursorCol = clampTimelineCol(desiredCol, state.timelineLinePlain, state.timelineCursorRow);
  state.timelineCurswant = desiredCol;
  syncTimelineSelectionToCursor(state);
}

export function moveTimelineCursorCols(state: AppState, delta: number): void {
  if (state.timelineLinePlain.length === 0) return;
  state.timelineCursorCol = clampTimelineCol(state.timelineCursorCol + delta, state.timelineLinePlain, state.timelineCursorRow);
  state.timelineCurswant = null;
}

export function moveTimelineCursorLineStart(state: AppState): void {
  if (state.timelineLinePlain.length === 0) return;
  state.timelineCursorCol = timelineContentBounds(state.timelineLinePlain[state.timelineCursorRow] ?? "").start;
  state.timelineCurswant = null;
}

export function moveTimelineCursorLineEnd(state: AppState): void {
  if (state.timelineLinePlain.length === 0) return;
  state.timelineCursorCol = timelineContentBounds(state.timelineLinePlain[state.timelineCursorRow] ?? "").end;
  state.timelineCurswant = null;
}

export function syncTimelineSelectionToCursor(state: AppState): void {
  const itemIndex = state.timelineLineItemIndexes[state.timelineCursorRow];
  if (itemIndex !== undefined && itemIndex >= 0 && itemIndex < state.items.length) {
    state.selectedIndex = itemIndex;
  }
}

export function syncTimelineCursorToSelection(state: AppState, starts: number[]): void {
  if (state.timelineLinePlain.length === 0) {
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 0;
    state.timelineCurswant = null;
    return;
  }
  const selectedLineItem = state.timelineLineItemIndexes[state.timelineCursorRow];
  if (selectedLineItem !== state.selectedIndex) {
    const nextRow = starts[state.selectedIndex] ?? 0;
    state.timelineCursorRow = Math.max(0, Math.min(nextRow, state.timelineLinePlain.length - 1));
    state.timelineCurswant = null;
  }
  clampTimelineCursor(state);
}

export function placeTimelineCursorAtVisibleBottom(state: AppState, visibleRows: number): void {
  const lines = state.timelineLinePlain;
  if (lines.length === 0) {
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 1;
    state.timelineCurswant = null;
    state.timelineVisualAnchor = { row: 0, col: 1 };
    return;
  }

  const row = Math.max(0, Math.min(state.scroll + Math.max(0, visibleRows - 1), lines.length - 1));
  state.timelineCursorRow = row;
  clampTimelineCursor(state, -1);
  state.timelineCursorCol = clampTimelineCol(0, lines, state.timelineCursorRow);
  state.timelineCurswant = null;
  state.timelineVisualAnchor = { row: state.timelineCursorRow, col: state.timelineCursorCol };
  syncTimelineSelectionToCursor(state);
}

export function scrollTimelineWithCursor(state: AppState, dir: number, amount: number, visibleRows: number): void {
  if (state.timelineLinePlain.length === 0) return;
  const next = scrollByAmountWithCursorInViewport({
    totalLines: state.timelineLinePlain.length,
    viewportHeight: visibleRows,
    viewStart: state.scroll,
    cursorRow: state.timelineCursorRow,
  }, dir, amount);
  const previousRow = state.timelineCursorRow;
  state.timelineCursorRow = next.cursorRow;
  clampTimelineCursor(state, Math.sign(next.cursorRow - previousRow));
  state.timelineCursorCol = clampTimelineCol(state.timelineCurswant ?? state.timelineCursorCol, state.timelineLinePlain, state.timelineCursorRow);
  state.scroll = next.viewStart;
  syncTimelineSelectionToCursor(state);
}

export function scrollTimelinePageWithCursor(state: AppState, dir: number, amount: number, visibleRows: number): void {
  if (state.timelineLinePlain.length === 0) return;
  const next = scrollPageWithCursorInViewport({
    totalLines: state.timelineLinePlain.length,
    viewportHeight: visibleRows,
    viewStart: state.scroll,
    cursorRow: state.timelineCursorRow,
  }, dir, amount);
  const previousRow = state.timelineCursorRow;
  state.timelineCursorRow = next.cursorRow;
  clampTimelineCursor(state, Math.sign(next.cursorRow - previousRow));
  state.timelineCursorCol = clampTimelineCol(state.timelineCurswant ?? state.timelineCursorCol, state.timelineLinePlain, state.timelineCursorRow);
  state.scroll = next.viewStart;
  syncTimelineSelectionToCursor(state);
}

export function scrollTimelineViewportSticky(state: AppState, dir: number, visibleRows: number): void {
  if (state.timelineLinePlain.length === 0) return;
  const next = scrollLineWithStickyCursorInViewport({
    totalLines: state.timelineLinePlain.length,
    viewportHeight: visibleRows,
    viewStart: state.scroll,
    cursorRow: state.timelineCursorRow,
  }, dir);
  const previousRow = state.timelineCursorRow;
  state.timelineCursorRow = next.cursorRow;
  clampTimelineCursor(state, Math.sign(next.cursorRow - previousRow));
  state.timelineCursorCol = clampTimelineCol(state.timelineCurswant ?? state.timelineCursorCol, state.timelineLinePlain, state.timelineCursorRow);
  state.scroll = next.viewStart;
  syncTimelineSelectionToCursor(state);
}
