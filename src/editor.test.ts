import { describe, expect, test } from "bun:test";
import { createEditorState, handleEditorKey } from "./editor";

function sendChars(editor: ReturnType<typeof createEditorState>, chars: string): void {
  for (const char of chars) handleEditorKey(editor, { type: "char", char });
}

describe("editor curswant", () => {
  test("insert-mode up/down preserve preferred column across short lines", () => {
    const editor = createEditorState("abcdef\nx\n123456789", "insert");
    editor.cursor = 5;

    handleEditorKey(editor, { type: "down" });
    expect(editor.cursor).toBe(8); // insert cursor may sit after the short line

    handleEditorKey(editor, { type: "down" });
    expect(editor.cursor).toBe(14);
    expect(editor.curswant).toBe(5);
  });

  test("normal-mode j/k preserve preferred column without landing past line end", () => {
    const editor = createEditorState("abcdef\nx\n123456789", "normal");
    editor.cursor = 5;

    handleEditorKey(editor, { type: "char", char: "j" });
    expect(editor.cursor).toBe(7); // on x, not after x

    handleEditorKey(editor, { type: "char", char: "j" });
    expect(editor.cursor).toBe(14);
  });

  test("horizontal prompt motion resets the preferred column", () => {
    const editor = createEditorState("abcdef\nx\n123456789", "insert");
    editor.cursor = 5;

    handleEditorKey(editor, { type: "down" });
    handleEditorKey(editor, { type: "down" });
    expect(editor.cursor).toBe(14);

    handleEditorKey(editor, { type: "left" });
    expect(editor.cursor).toBe(13);
    expect(editor.curswant).toBeNull();

    handleEditorKey(editor, { type: "up" });
    expect(editor.cursor).toBe(8);
    handleEditorKey(editor, { type: "down" });
    expect(editor.cursor).toBe(13); // new column 4, not stale column 5
  });

  test("normal-mode h/l do not treat newline delimiters as prompt characters", () => {
    const editor = createEditorState("ab\ncd", "normal");

    editor.cursor = 1; // b, last character before newline
    handleEditorKey(editor, { type: "char", char: "l" });
    expect(editor.cursor).toBe(1);
    expect(editor.buffer[editor.cursor]).toBe("b");

    editor.cursor = 3; // c, first character after newline
    handleEditorKey(editor, { type: "char", char: "h" });
    expect(editor.cursor).toBe(3);
    expect(editor.buffer[editor.cursor]).toBe("c");
  });
});

describe("editor delete commands", () => {
  test("delete commands change text without entering yank/paste state", () => {
    const cases: Array<[string, (editor: ReturnType<typeof createEditorState>) => void]> = [
      ["x", (editor) => sendChars(editor, "x")],
      ["X", (editor) => { editor.cursor = 1; sendChars(editor, "X"); }],
      ["dd", (editor) => sendChars(editor, "dd")],
      ["D", (editor) => sendChars(editor, "D")],
      ["dw", (editor) => sendChars(editor, "dw")],
      ["visual d", (editor) => sendChars(editor, "vwd")],
    ];

    for (const [name, run] of cases) {
      const editor = createEditorState("alpha beta\ngamma", "normal");
      run(editor);

      expect(editor.buffer, name).not.toBe("alpha beta\ngamma");
      expect(editor.pendingOperator, name).toBeNull();
      expect(editor.pendingOperatorKey, name).toBeNull();
      expect(editor.pendingKeys, name).toBe("");
    }
  });
});
