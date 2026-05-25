import { describe, expect, test } from "bun:test";

import { renderPromptSeparator } from "./promptbar";
import { createInitialState } from "./state";
import { theme } from "./theme";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

describe("promptbar", () => {
  test("embeds active reply target in the prompt separator like record", () => {
    const state = createInitialState();
    state.items = [{ id: "tweet-1", name: "Other", handle: "other", text: "original tweet that is definitely long enough to truncate in the separator", created_at: "", url: "" }];
    state.replyTargetId = "tweet-1";

    const line = renderPromptSeparator(state, 100, theme.accent);
    const plain = stripAnsi(line);

    expect(plain).toContain("────↩ Replying: @other: original tweet that is definitely long …");
    expect(plain.endsWith("─")).toBe(true);
    expect(line).toContain(`${theme.muted}↩ Replying: ${theme.accent}@other: ${theme.text}`);
  });

  test("embeds active quote target in the prompt separator", () => {
    const state = createInitialState();
    state.items = [{ id: "tweet-1", name: "Other", handle: "other", text: "quote target", created_at: "", url: "" }];
    state.quoteTargetId = "tweet-1";

    const plain = stripAnsi(renderPromptSeparator(state, 80, theme.accent));

    expect(plain).toContain("────↻ Quote: @other: quote target");
  });

  test("cleans tweet summaries for inline prompt context", () => {
    const state = createInitialState();
    state.items = [{ id: "tweet-1", name: "Other", handle: "other", text: "Claude Code &amp; Codex\nnext line", created_at: "", url: "" }];
    state.replyTargetId = "tweet-1";

    const plain = stripAnsi(renderPromptSeparator(state, 80, theme.accent));

    expect(plain).toContain("Claude Code & Codex next line");
  });

  test("falls back to a plain separator without active prompt context", () => {
    expect(stripAnsi(renderPromptSeparator(createInitialState(), 8, theme.accent))).toBe("────────");
  });
});
