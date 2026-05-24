/**
 * Followers status block — Twitter follower count.
 */

import type { AppState } from "../state";
import type { StatusBlock } from "../statusline";
import { theme } from "../theme";
import { termWidth, truncateToWidth } from "../textwidth";

const MAX_VALUE_WIDTH = 18;

function formatFollowers(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return String(value ?? "N/A");
  return new Intl.NumberFormat("en-US").format(n);
}

export function followersBlock(state: AppState): StatusBlock {
  const label = "  Followers: ";
  const value = state.accountStatus === "authenticated" && state.account ? formatFollowers(state.account.followers) : "N/A";
  const color = state.accountStatus === "authenticated" && state.account ? theme.accent : theme.error;
  const displayValue = truncateToWidth(value, MAX_VALUE_WIDTH);
  const width = termWidth(label) + termWidth(displayValue);

  return {
    id: "followers",
    priority: 1,
    width,
    height: 1,
    rows: [
      `${theme.muted}${label}${color}${displayValue}${theme.reset}`,
    ],
  };
}
