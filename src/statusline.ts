/**
 * Status line layout engine.
 *
 * Copied from record's block-based statusline UI/UX: status blocks are composed
 * left-to-right with accent delimiters, lower-priority blocks drop first when
 * narrow, and rows are padded/truncated by terminal display width.
 */

import type { AppState } from "./state";
import { theme } from "./theme";
import { termWidth, truncateToWidth } from "./textwidth";

import { accountBlock } from "./statusblocks/account";
import { followersBlock } from "./statusblocks/followers";

export interface StatusBlock {
  id: string;
  priority: number;
  width: number;
  height: number;
  rows: string[];
}

type BlockBuilder = (state: AppState) => StatusBlock | null;

// The Twitter TUI intentionally has only these two status blocks.
const BLOCK_BUILDERS: BlockBuilder[] = [
  accountBlock,
  followersBlock,
];

const DELIMITER_WIDTH = 3; // " │ "

function layoutBlocks(state: AppState, cols: number): StatusBlock[] {
  const candidates: { block: StatusBlock; position: number }[] = [];
  for (let i = 0; i < BLOCK_BUILDERS.length; i++) {
    const block = BLOCK_BUILDERS[i](state);
    if (block) candidates.push({ block, position: i });
  }

  const byPriority = [...candidates].sort((a, b) => b.block.priority - a.block.priority);

  const selectedPositions = new Set<number>();
  let used = 0;
  for (const { block, position } of byPriority) {
    const need = selectedPositions.size === 0 ? block.width : DELIMITER_WIDTH + block.width;
    if (used + need <= cols || selectedPositions.size === 0) {
      selectedPositions.add(position);
      used += Math.min(need, cols);
    }
  }

  return candidates
    .filter((candidate) => selectedPositions.has(candidate.position))
    .map((candidate) => candidate.block);
}

function blockRow(block: StatusBlock, rowIndex: number, width: number): string {
  const row = rowIndex < block.height ? block.rows[rowIndex] : "";
  if (width >= block.width) return row + " ".repeat(Math.max(0, width - block.width));
  return truncateToWidth(row, width);
}

function composeRow(blocks: StatusBlock[], rowIndex: number, cols: number): string {
  let out = "";
  let usedCols = 0;
  for (let i = 0; i < blocks.length && usedCols < cols; i++) {
    if (i > 0) {
      const delimiter = `${theme.accent} │ `;
      out += delimiter;
      usedCols += DELIMITER_WIDTH;
      if (usedCols >= cols) break;
    }
    const block = blocks[i];
    const width = Math.min(block.width, cols - usedCols);
    out += blockRow(block, rowIndex, width);
    usedCols += width;
  }

  const remaining = cols - usedCols;
  if (remaining > 0) out += " ".repeat(remaining);
  out += theme.reset;
  return out;
}

export interface StatusLineResult {
  height: number;
  lines: string[];
}

export function renderStatusLine(state: AppState, cols: number): StatusLineResult {
  const blocks = layoutBlocks(state, cols);
  if (blocks.length === 0) return { height: 0, lines: [] };

  const height = Math.max(...blocks.map((block) => block.height));
  const lines: string[] = [];
  for (let i = 0; i < height; i++) {
    lines.push(composeRow(blocks, i, cols));
  }
  return { height, lines };
}
