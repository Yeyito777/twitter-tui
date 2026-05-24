import { describe, expect, test } from "bun:test";
import { createInitialState } from "./state";
import { displayTweetText, render } from "./render";
import { theme } from "./theme";

describe("timeline loading render", () => {
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
    expect(output).toContain("Loading replies");
    expect(output).not.toContain("Loading timeline");
    expect(output.indexOf("Loading replies")).toBeGreaterThan(output.indexOf("main tweet"));
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
