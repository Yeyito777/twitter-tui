import type { AppState } from "./state";
import { findOpenableTargetMatches } from "./openable";
import { stripTimelineAnsi, timelineContentBounds } from "./timelinecursor";
interface LogicalCursorLine {
  text: string;
  cursorOffset: number;
}

function logicalLineAtTimelineCursor(state: AppState): LogicalCursorLine | null {
  const row = state.timelineCursorRow;
  const lines = state.timelineLinePlain;
  if (row < 0 || row >= lines.length) return null;
  const plain = stripTimelineAnsi(lines[row] ?? "");
  const bounds = timelineContentBounds(plain);
  const segment = plain.slice(bounds.start, bounds.end + 1);
  const col = state.timelineCursorCol;
  if (col < bounds.start || col > bounds.end) return null;
  const cursorOffset = Math.max(0, Math.min(col - bounds.start, Math.max(0, segment.length - 1)));
  return { text: segment, cursorOffset };
}

export function openableTargetAtTimelineCursor(state: AppState): string | null {
  const logicalLine = logicalLineAtTimelineCursor(state);
  if (logicalLine) {
    for (const match of findOpenableTargetMatches(logicalLine.text)) {
      if (logicalLine.cursorOffset >= match.start && logicalLine.cursorOffset < match.end) return match.target;
    }
  }

  return null;
}
