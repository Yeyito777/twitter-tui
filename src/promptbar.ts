/** Prompt separator chrome, copied from record's reply-context UX. */

import type { AppState } from "./state";
import { theme } from "./theme";
import { isTweet } from "./types";
import { termWidth, truncateToWidth } from "./textwidth";

const MAX_REPLY_SUMMARY_WIDTH = 40;
const MAX_QUOTE_SUMMARY_WIDTH = 40;
const CONTEXT_LEADING_DASHES = 4;

interface PromptContextSegment {
  text: string;
  width: number;
}

function targetTweet(state: AppState, targetId: string) {
  const target = state.items.find((item) => isTweet(item) && item.id === targetId);
  if (!isTweet(target)) return null;
  return target.is_retweet && target.retweeted ? target.retweeted : target;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function summaryText(text: string): string {
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

function replySegment(state: AppState): PromptContextSegment | null {
  const targetId = state.replyTargetId;
  if (!targetId) return null;

  const tweet = targetTweet(state, targetId);
  const icon = "↩";
  const label = " Replying: ";
  const name = `${tweet?.handle ? `@${tweet.handle}` : targetId}: `;
  const summary = truncateToWidth(summaryText(tweet?.text ?? ""), MAX_REPLY_SUMMARY_WIDTH);
  const nameColor = tweet?.handle ? theme.accent : theme.muted;
  const text = `${theme.muted}${icon}${label}${nameColor}${name}${theme.text}${summary}${theme.reset}`;

  return { text, width: termWidth(text) };
}

function quoteSegment(state: AppState): PromptContextSegment | null {
  const targetId = state.quoteTargetId;
  if (!targetId) return null;

  const tweet = targetTweet(state, targetId);
  const icon = "↻";
  const label = " Quote: ";
  const name = `${tweet?.handle ? `@${tweet.handle}` : targetId}: `;
  const summary = truncateToWidth(summaryText(tweet?.text ?? ""), MAX_QUOTE_SUMMARY_WIDTH);
  const nameColor = tweet?.handle ? theme.accent : theme.muted;
  const text = `${theme.muted}${icon}${label}${nameColor}${name}${theme.text}${summary}${theme.reset}`;

  return { text, width: termWidth(text) };
}

function activePromptContextSegment(state: AppState): PromptContextSegment | null {
  return quoteSegment(state) ?? replySegment(state);
}

export function renderPromptSeparator(state: AppState, width: number, separatorColor: string): string {
  const safeWidth = Math.max(0, width);
  if (safeWidth === 0) return "";

  const segment = activePromptContextSegment(state);
  if (!segment) return `${separatorColor}${"─".repeat(safeWidth)}${theme.reset}`;

  const leftWidth = Math.min(CONTEXT_LEADING_DASHES, Math.max(0, safeWidth - 1));
  const available = safeWidth - leftWidth;
  const reserveRightDash = available > 1 ? 1 : 0;
  const segmentWidth = Math.min(segment.width, Math.max(0, available - reserveRightDash));

  if (segmentWidth <= 0) return `${separatorColor}${"─".repeat(safeWidth)}${theme.reset}`;

  const segmentText = segmentWidth < segment.width ? truncateToWidth(segment.text, segmentWidth) : segment.text;
  const rightWidth = Math.max(0, safeWidth - leftWidth - termWidth(segmentText));

  return `${separatorColor}${"─".repeat(leftWidth)}${segmentText}${separatorColor}${"─".repeat(rightWidth)}${theme.reset}`;
}
