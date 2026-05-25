import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { cycleAutocomplete, tryPathComplete, updateAutocomplete } from "./autocomplete";
import { createInitialState } from "./state";

describe("prompt autocomplete", () => {
  test("shows slash command matches at prompt start and cycles like record", () => {
    const state = createInitialState();
    state.editor.buffer = "/th";
    state.editor.cursor = state.editor.buffer.length;

    updateAutocomplete(state);

    expect(state.autocomplete?.type).toBe("command");
    expect(state.autocomplete?.matches.map((match) => match.name)).toContain("/thread");
    cycleAutocomplete(state, 1);
    expect(state.editor.buffer).toBe("/thread");
  });

  test("shows command argument completions", () => {
    const state = createInitialState();
    state.editor.buffer = "/theme ";
    state.editor.cursor = state.editor.buffer.length;

    updateAutocomplete(state);

    expect(state.autocomplete?.matches.map((match) => match.name)).toContain("whale");
  });

  test("tab-completes path matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "twitter-tui-path-ac-test-"));
    try {
      mkdirSync(join(dir, "alpha-dir"));
      writeFileSync(join(dir, "alpha-file.txt"), "hello");
      const state = createInitialState();
      state.editor.buffer = `${dir}/alpha`;
      state.editor.cursor = state.editor.buffer.length;

      expect(tryPathComplete(state)).toBe(true);
      expect(state.autocomplete?.type).toBe("path");
      expect(state.autocomplete?.matches).toEqual([
        { name: `${dir}/alpha-dir/`, desc: "dir" },
        { name: `${dir}/alpha-file.txt`, desc: "file" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
