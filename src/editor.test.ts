import { describe, expect, test } from "bun:test";
import { createEditorState, handleEditorKey } from "./editor";

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
