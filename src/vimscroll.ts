/**
 * Vim-style viewport/cursor scrolling.
 *
 * Copied from record's vimscroll.ts so timeline focus behaves exactly like
 * record chat history for Ctrl+E/Y/D/U/B/F.
 */

export interface CursorViewport {
  totalLines: number;
  viewportHeight: number;
  viewStart: number;
  cursorRow: number;
}

export function maxViewStartFor(totalLines: number, viewportHeight: number): number {
  return Math.max(0, totalLines - viewportHeight);
}

export function clampViewStart(totalLines: number, viewportHeight: number, viewStart: number): number {
  return Math.max(0, Math.min(viewStart, maxViewStartFor(totalLines, viewportHeight)));
}

export function ensureCursorRowVisibleInViewport(view: CursorViewport): CursorViewport {
  const viewportHeight = Math.max(0, view.viewportHeight);
  const totalLines = Math.max(0, view.totalLines);
  if (totalLines === 0 || viewportHeight <= 0 || totalLines <= viewportHeight) {
    return {
      ...view,
      totalLines,
      viewportHeight,
      viewStart: 0,
      cursorRow: Math.max(0, Math.min(view.cursorRow, Math.max(0, totalLines - 1))),
    };
  }

  const cursorRow = Math.max(0, Math.min(view.cursorRow, totalLines - 1));
  let viewStart = clampViewStart(totalLines, viewportHeight, view.viewStart);
  const viewEndExclusive = viewStart + viewportHeight;

  if (cursorRow < viewStart) {
    viewStart = cursorRow;
  } else if (cursorRow >= viewEndExclusive) {
    viewStart = cursorRow - viewportHeight + 1;
  }

  return { ...view, totalLines, viewportHeight, viewStart: clampViewStart(totalLines, viewportHeight, viewStart), cursorRow };
}

export function scrollLineWithStickyCursorInViewport(view: CursorViewport, dir: number): CursorViewport {
  const totalLines = Math.max(0, view.totalLines);
  if (totalLines === 0) return { ...view, totalLines, viewStart: 0, cursorRow: 0 };

  const viewportHeight = Math.max(0, view.viewportHeight);
  const viewStart = clampViewStart(totalLines, viewportHeight, view.viewStart - dir);
  const viewEnd = viewStart + viewportHeight - 1;
  let cursorRow = Math.max(0, Math.min(view.cursorRow, totalLines - 1));

  if (cursorRow < viewStart) cursorRow = viewStart;
  else if (cursorRow > viewEnd) cursorRow = viewEnd;
  cursorRow = Math.max(0, Math.min(cursorRow, totalLines - 1));

  return { ...view, totalLines, viewportHeight, viewStart, cursorRow };
}

export function scrollByAmountWithCursorInViewport(view: CursorViewport, dir: number, amount: number): CursorViewport {
  const totalLines = Math.max(0, view.totalLines);
  if (totalLines === 0) return { ...view, totalLines, viewStart: 0, cursorRow: 0 };

  const lines = dir * amount;
  const viewportHeight = Math.max(0, view.viewportHeight);
  const cursorRow = Math.max(0, Math.min(view.cursorRow - lines, totalLines - 1));
  const viewStart = clampViewStart(totalLines, viewportHeight, view.viewStart - lines);

  return ensureCursorRowVisibleInViewport({ ...view, totalLines, viewportHeight, viewStart, cursorRow });
}

export function scrollPageWithCursorInViewport(view: CursorViewport, dir: number, amount: number): CursorViewport {
  const totalLines = Math.max(0, view.totalLines);
  if (totalLines === 0) return { ...view, totalLines, viewStart: 0, cursorRow: 0 };

  const lines = dir * amount;
  const viewportHeight = Math.max(0, view.viewportHeight);
  const viewStart = clampViewStart(totalLines, viewportHeight, view.viewStart - lines);
  const viewEnd = viewStart + Math.max(0, viewportHeight) - 1;
  const cursorRow = Math.max(0, Math.min(Math.max(viewStart, Math.min(view.cursorRow, viewEnd)), totalLines - 1));

  return { ...view, totalLines, viewportHeight, viewStart, cursorRow };
}
