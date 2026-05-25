import { describe, expect, test } from "bun:test";
import { createInitialState } from "./state";
import { colorizeHandles, decodeHtmlEntities, displayTweetText, render, renderTweetCard } from "./render";
import { theme, themes } from "./theme";
import { disableAutowrap, enableAutowrap } from "./terminal";

describe("timeline loading render", () => {
  test("render disables autowrap while painting full-width rows", () => {
    const state = createInitialState();
    state.cols = 80;
    state.rows = 16;
    state.items = [{ id: "1", name: "A", handle: "a", text: "hello", created_at: "", url: "" }];

    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array) => { output += String(chunk); return true; };
    try {
      render(state);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(output.startsWith(disableAutowrap)).toBe(true);
    expect(output.endsWith(enableAutowrap)).toBe(true);
  });

  test("topbar and separator rows are painted with current theme background", () => {
    const previous = { ...theme };
    Object.assign(theme, themes.cerberus);
    const topbarBg = theme.topbarBg;
    const appBg = theme.appBg ?? "";
    const state = createInitialState();
    state.cols = 80;
    state.rows = 16;
    state.items = [{ id: "1", name: "A", handle: "a", text: "hello", created_at: "", url: "" }];

    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array) => { output += String(chunk); return true; };
    try {
      render(state);
    } finally {
      process.stdout.write = originalWrite;
      Object.assign(theme, previous);
    }

    expect(output).toContain(topbarBg);
    expect(output).toContain(`${appBg}\x1b[K`);
    expect(output).toContain("─".repeat(10));
  });

  test("thread loads show replies loader below cached main tweet", () => {
    const state = createInitialState();
    state.cols = 100;
    state.rows = 24;
    state.feedKind = "thread";
    state.title = "Thread 1";
    state.timelineLoading = true;
    state.loadingFrameIndex = 0;
    state.items = [{ id: "1", name: "A", handle: "a", text: "main tweet", created_at: "2026-05-24 00:00", url: "https://x.com/a/status/1" }];

    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array) => { output += String(chunk); return true; };
    try {
      render(state);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(output).toContain("main tweet");
    expect(output).toContain("Loading Replies");
    expect(output).not.toContain("Loading Timeline");
    expect(output.indexOf("Loading Replies")).toBeGreaterThan(output.indexOf("main tweet"));
  });

  test("cleared top-level view loads render specific loading labels", () => {
    const state = createInitialState();
    state.cols = 100;
    state.rows = 24;
    state.timelineLoading = true;
    state.timelineLoadingLabel = "Loading Latest…";
    state.items = [];

    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array) => { output += String(chunk); return true; };
    try {
      render(state);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(output).toContain("Loading Latest");
    expect(output).not.toContain("Loading Timeline");
  });
});

describe("prompt visual render", () => {
  test("prompt visual selection renders in prompt, not chat history", () => {
    const state = createInitialState();
    state.cols = 100;
    state.rows = 24;
    state.panelFocus = "content";
    state.contentFocus = "prompt";
    state.editor.buffer = "hello world";
    state.editor.mode = "visual-line";
    state.editor.visualAnchor = 0;
    state.editor.cursor = 4;
    state.timelineLinePlain = [" tweet line"];
    state.timelineLineItemIndexes = [0];
    state.timelineVisualAnchor = { row: 0, col: 1 };
    state.timelineCursorRow = 0;
    state.timelineCursorCol = 1;
    state.items = [{ id: "1", name: "A", handle: "a", text: "tweet line", created_at: "", url: "" }];

    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array) => { output += String(chunk); return true; };
    try {
      render(state);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(output).toContain("hello world");
    expect(output).toContain(theme.selectionBg);
    expect(output.split(theme.selectionBg).length - 1).toBe(1);
  });
});

describe("timeline visual render", () => {
  test("visual-line selection highlights rendered lines without selected tweet card background", () => {
    const state = createInitialState();
    state.cols = 100;
    state.rows = 24;
    state.panelFocus = "content";
    state.contentFocus = "timeline";
    state.editor.mode = "visual-line";
    state.timelineVisualAnchor = { row: 0, col: 1 };
    state.timelineCursorRow = 1;
    state.timelineCursorCol = 1;
    state.items = [{ id: "1", name: "A", handle: "a", text: "first\nsecond", created_at: "", url: "" }];
    state.timelineLineItemIndexes = [0, 0];
    state.timelineLinePlain = [" A @a", " first"];

    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array) => { output += String(chunk); return true; };
    try {
      render(state);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(output).toContain(theme.selectionBg);
    expect(output).not.toContain(theme.historyLineBg);
  });
});

describe("tweet text display", () => {
  test("@handles inside tweet text are colorized like names", () => {
    const colorized = colorizeHandles("hi @alice and x@y.com @bob_123");
    expect(colorized).toContain("@alice");
    expect(colorized).toContain("@bob_123");
    expect(colorized).toContain(theme.reset);
    expect(colorized).toContain("x@y.com");
  });

  test("HTML entities from Twitter text are decoded", () => {
    expect(decodeHtmlEntities("&gt; GPT &amp; friends &lt;3 &quot;ok&quot; &#39;yep&#39;")).toBe("> GPT & friends <3 \"ok\" 'yep'");
    expect(displayTweetText({ id: "5", name: "B", handle: "b", text: "&gt; GPT-5.1-Codex-Max", created_at: "", url: "" })).toBe("> GPT-5.1-Codex-Max");
  });

  test("reply tweets hide the leading replied-to mention", () => {
    expect(displayTweetText({
      id: "2",
      name: "B",
      handle: "b",
      text: "@alice yep exactly",
      created_at: "2026-05-24 00:00",
      url: "https://x.com/b/status/2",
      is_reply: true,
      in_reply_to: "alice",
    })).toBe("yep exactly");
  });

  test("non-leading mentions and non-replies are preserved", () => {
    expect(displayTweetText({ id: "3", name: "B", handle: "b", text: "hey @alice", created_at: "", url: "" })).toBe("hey @alice");
    expect(displayTweetText({ id: "4", name: "B", handle: "b", text: "cc @alice hey", created_at: "", url: "", is_reply: true, in_reply_to: "alice" })).toBe("cc @alice hey");
  });
});

describe("quoted tweet render", () => {
  test("quote tweets use markdown-style quote block gutter", () => {
    const rows = renderTweetCard({
      id: "1",
      name: "A",
      handle: "a",
      text: "parent",
      created_at: "",
      url: "",
      quoted: {
        id: "2",
        name: "B",
        handle: "b",
        text: "&gt; quoted line one\nquoted line two",
        created_at: "",
        url: "",
        likes: 1,
        retweets: 2,
      },
    }, 80, false).join("\n");

    expect(rows).toContain("▎ quote @b");
    expect(rows).toContain("▎ > quoted line one");
    expect(rows).toContain("▎ quoted line two");
    expect(rows).toContain("▎ ♥ 1  ↻ 2");
  });
});
