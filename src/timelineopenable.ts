import type { AppState } from "./state";
import { findOpenableTargetMatches } from "./openable";
import { stripTimelineAnsi, timelineContentBounds } from "./timelinecursor";
import { isTweet } from "./types";

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

function selectedTweetUrl(state: AppState): string | null {
  const item = state.items[state.selectedIndex];
  if (!isTweet(item)) return null;
  const subject = item.is_retweet && item.retweeted ? item.retweeted : item;
  return subject.url || null;
}

export function openableTargetAtTimelineCursor(state: AppState): string | null {
  const logicalLine = logicalLineAtTimelineCursor(state);
  if (logicalLine) {
    for (const match of findOpenableTargetMatches(logicalLine.text)) {
      if (logicalLine.cursorOffset >= match.start && logicalLine.cursorOffset < match.end) return match.target;
    }
  }

  const item = state.items[state.selectedIndex];
  if (isTweet(item)) {
    const subject = item.is_retweet && item.retweeted ? item.retweeted : item;
    for (const media of subject.media ?? []) {
      const target = media.expanded_url || media.url;
      if (target) return target;
    }
  }

  return selectedTweetUrl(state);
}
