/** Timeline visual selection helpers, ported from record's history visual mode. */

import { copyToClipboard } from "./editor-clipboard";
import type { KeyEvent } from "./input";
import type { AppState } from "./state";
import { theme } from "./theme";
import { clampTimelineCol, moveTimelineCursorCols, moveTimelineCursorLineEnd, moveTimelineCursorLineStart, moveTimelineCursorRows, setTimelineCursorToRow, stripTimelineAnsi, timelineContentBounds } from "./timelinecursor";
import { renderLineWithSelection } from "./historyrender";

type TimelineCursor = { row: number; col: number };

type TimelineRange = { start: TimelineCursor; end: TimelineCursor };

function isVisualMode(state: AppState): boolean {
  return state.editor.mode === "visual" || state.editor.mode === "visual-line";
}

function resetPending(state: AppState): void {
  state.editor.pendingKeys = "";
  state.editor.pendingOperator = null;
  state.editor.pendingOperatorKey = null;
  state.editor.pendingTextObjectModifier = null;
  state.editor.count = null;
  state.editor.pendingFind = null;
  state.editor.pendingReplace = false;
}

function normalizeSelection(anchor: TimelineCursor, cursor: TimelineCursor): TimelineRange {
  const forward = anchor.row < cursor.row || (anchor.row === cursor.row && anchor.col <= cursor.col);
  return { start: forward ? anchor : cursor, end: forward ? cursor : anchor };
}

export function getTimelineVisualSelection(state: AppState): string {
  const { start, end } = normalizeSelection(state.timelineVisualAnchor, { row: state.timelineCursorRow, col: state.timelineCursorCol });
  const lines = state.timelineLinePlain;

  if (state.editor.mode === "visual-line") {
    const parts: string[] = [];
    for (let row = start.row; row <= end.row; row++) parts.push(stripTimelineAnsi(lines[row] ?? "").trimEnd());
    return parts.join("\n");
  }

  if (start.row === end.row) {
    return stripTimelineAnsi(lines[start.row] ?? "").slice(start.col, end.col + 1);
  }

  const parts: string[] = [];
  for (let row = start.row; row <= end.row; row++) {
    const plain = stripTimelineAnsi(lines[row] ?? "");
    const bounds = timelineContentBounds(plain);
    const sliceStart = row === start.row ? start.col : bounds.start;
    const sliceEnd = row === end.row ? end.col + 1 : bounds.end + 1;
    parts.push(plain.slice(sliceStart, sliceEnd));
  }
  return parts.join("\n");
}

export function copyTimelineSelection(state: AppState): void {
  const text = getTimelineVisualSelection(state);
  if (text) copyToClipboard(text);
}

export function lineSelectionRangeForRow(state: AppState, row: number): { start: number; end: number } | null {
  if (!isVisualMode(state)) return null;
  const { start, end } = normalizeSelection(state.timelineVisualAnchor, { row: state.timelineCursorRow, col: state.timelineCursorCol });
  if (row < start.row || row > end.row) return null;
  if (state.editor.mode === "visual-line") return { start: -1, end: Number.MAX_SAFE_INTEGER };
  const plain = state.timelineLinePlain[row] ?? "";
  const bounds = timelineContentBounds(plain);
  return {
    start: row === start.row ? start.col : bounds.start,
    end: row === end.row ? end.col : bounds.end,
  };
}

export function applyTimelineVisualSelection(state: AppState, line: string, row: number): string {
  const range = lineSelectionRangeForRow(state, row);
  if (!range) return line;
  if (range.start === -1) return renderLineWithSelection(line, -1, Number.MAX_SAFE_INTEGER);
  return renderLineWithSelection(line, range.start, range.end);
}

function findForward(state: AppState, char: string): void {
  const plain = state.timelineLinePlain[state.timelineCursorRow] ?? "";
  const { end } = timelineContentBounds(plain);
  for (let col = state.timelineCursorCol + 1; col <= end; col++) {
    if (plain[col] === char) {
      state.timelineCursorCol = col;
      state.timelineCurswant = null;
      return;
    }
  }
}

function findBackward(state: AppState, char: string): void {
  const plain = state.timelineLinePlain[state.timelineCursorRow] ?? "";
  const { start } = timelineContentBounds(plain);
  for (let col = state.timelineCursorCol - 1; col >= start; col--) {
    if (plain[col] === char) {
      state.timelineCursorCol = col;
      state.timelineCurswant = null;
      return;
    }
  }
}

function wordForward(state: AppState): void {
  const lines = state.timelineLinePlain;
  let row = state.timelineCursorRow;
  let col = state.timelineCursorCol;
  while (row < lines.length) {
    const plain = lines[row] ?? "";
    const { start, end } = timelineContentBounds(plain);
    if (col < start) col = start;
    while (col <= end && /\S/.test(plain[col] ?? "")) col++;
    while (col <= end && /\s/.test(plain[col] ?? "")) col++;
    if (col <= end) break;
    row++;
    col = 0;
  }
  if (row < lines.length) {
    state.timelineCursorRow = row;
    state.timelineCursorCol = clampTimelineCol(col, lines, row);
    state.timelineCurswant = null;
  }
}

function wordBackward(state: AppState): void {
  const lines = state.timelineLinePlain;
  let row = state.timelineCursorRow;
  let col = state.timelineCursorCol - 1;
  while (row >= 0) {
    const plain = lines[row] ?? "";
    const { start, end } = timelineContentBounds(plain);
    if (col > end) col = end;
    while (col > start && /\s/.test(plain[col] ?? "")) col--;
    while (col > start && /\S/.test(plain[col - 1] ?? "")) col--;
    if (col >= start) break;
    row--;
    col = Number.MAX_SAFE_INTEGER;
  }
  if (row >= 0) {
    state.timelineCursorRow = row;
    state.timelineCursorCol = clampTimelineCol(col, lines, row);
    state.timelineCurswant = null;
  }
}

function wordEnd(state: AppState): void {
  wordForward(state);
  const plain = state.timelineLinePlain[state.timelineCursorRow] ?? "";
  const { end } = timelineContentBounds(plain);
  let col = state.timelineCursorCol;
  while (col < end && /\S/.test(plain[col + 1] ?? "")) col++;
  state.timelineCursorCol = col;
}

export function handleTimelineVisualKey(state: AppState, key: KeyEvent, onMove?: () => void): boolean {
  if (state.timelineLinePlain.length === 0) return false;

  if (state.editor.pendingFind) {
    if (key.type === "char" && key.char) {
      const direction = state.editor.pendingFind;
      state.editor.lastFind = { char: key.char, direction };
      direction === "f" ? findForward(state, key.char) : findBackward(state, key.char);
    }
    state.editor.pendingFind = null;
    onMove?.();
    return true;
  }

  if (key.type === "escape") {
    if (isVisualMode(state)) state.editor.mode = "normal";
    resetPending(state);
    return true;
  }
  if (key.type === "left") { moveTimelineCursorCols(state, -1); onMove?.(); return true; }
  if (key.type === "right") { moveTimelineCursorCols(state, 1); onMove?.(); return true; }
  if (key.type === "up") { moveTimelineCursorRows(state, -1); onMove?.(); return true; }
  if (key.type === "down") { moveTimelineCursorRows(state, 1); onMove?.(); return true; }
  if (key.type === "home") { moveTimelineCursorLineStart(state); onMove?.(); return true; }
  if (key.type === "end") { moveTimelineCursorLineEnd(state); onMove?.(); return true; }
  if (key.type !== "char" || !key.char) return false;

  const c = key.char;
  if (isVisualMode(state)) {
    if ((c === "v" && state.editor.mode === "visual") || (c === "V" && state.editor.mode === "visual-line")) {
      state.editor.mode = "normal";
      resetPending(state);
      return true;
    }
    if (c === "V" && state.editor.mode === "visual") { state.editor.mode = "visual-line"; return true; }
    if (c === "v" && state.editor.mode === "visual-line") { state.editor.mode = "visual"; return true; }
    if (c === "y") {
      copyTimelineSelection(state);
      state.editor.mode = "normal";
      resetPending(state);
      return true;
    }
  } else {
    if (state.editor.pendingOperator === "yank") {
      if (c === "y") {
        const text = stripTimelineAnsi(state.timelineLinePlain[state.timelineCursorRow] ?? "").trimEnd();
        if (text) copyToClipboard(text);
      }
      resetPending(state);
      return true;
    }
    if (c === "v") {
      state.editor.mode = "visual";
      state.timelineVisualAnchor = { row: state.timelineCursorRow, col: state.timelineCursorCol };
      resetPending(state);
      return true;
    }
    if (c === "V") {
      state.editor.mode = "visual-line";
      state.timelineVisualAnchor = { row: state.timelineCursorRow, col: state.timelineCursorCol };
      resetPending(state);
      return true;
    }
    if (c === "y") {
      state.editor.pendingOperator = "yank";
      state.editor.pendingOperatorKey = "y";
      state.editor.pendingKeys = "y";
      return true;
    }
  }

  switch (c) {
    case "h": moveTimelineCursorCols(state, -1); break;
    case "l": moveTimelineCursorCols(state, 1); break;
    case "j": moveTimelineCursorRows(state, 1); break;
    case "k": moveTimelineCursorRows(state, -1); break;
    case "0": moveTimelineCursorLineStart(state); break;
    case "$": moveTimelineCursorLineEnd(state); break;
    case "g":
      if (state.editor.pendingKeys === "g") {
        setTimelineCursorToRow(state, 0);
        resetPending(state);
      } else {
        state.editor.pendingKeys = "g";
        return true;
      }
      break;
    case "G": setTimelineCursorToRow(state, Math.max(0, state.timelineLinePlain.length - 1)); break;
    case "w": wordForward(state); break;
    case "b": wordBackward(state); break;
    case "e": wordEnd(state); break;
    case "f": state.editor.pendingFind = "f"; return true;
    case "F": state.editor.pendingFind = "F"; return true;
    case ";": {
      const last = state.editor.lastFind;
      if (last) last.direction === "f" ? findForward(state, last.char) : findBackward(state, last.char);
      break;
    }
    case ",": {
      const last = state.editor.lastFind;
      if (last) last.direction === "f" ? findBackward(state, last.char) : findForward(state, last.char);
      break;
    }
    default:
      resetPending(state);
      return false;
  }
  resetPending(state);
  onMove?.();
  return true;
}
