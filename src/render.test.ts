import { describe, expect, test } from "bun:test";
import { createInitialState } from "./state";
import { render } from "./render";

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
