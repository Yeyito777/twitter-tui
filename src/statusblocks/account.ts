/**
 * Account status block — who the user is logged in as.
 *
 * Copied from record's status-block style, adapted for Twitter account state.
 */

import type { AppState } from "../state";
import type { StatusBlock } from "../statusline";
import { theme } from "../theme";
import { termWidth, truncateToWidth } from "../textwidth";

const MAX_VALUE_WIDTH = 40;

export function accountBlock(state: AppState): StatusBlock {
  // Copied from record's account status block behavior: while the session is
  // not authenticated yet (including startup validation), show N/A in red.
  const label = "  Logged In As: ";
  const nickname = state.accountStatus === "authenticated" && state.account
    ? (state.account.name || state.account.handle)
    : "N/A";
  const color = state.accountStatus === "authenticated" && state.account ? theme.accent : theme.error;
  const displayValue = truncateToWidth(nickname, MAX_VALUE_WIDTH);
  const width = termWidth(label) + termWidth(displayValue);

  return {
    id: "account",
    priority: 2,
    width,
    height: 1,
    rows: [
      `${theme.muted}${label}${color}${displayValue}${theme.reset}`,
    ],
  };
}
