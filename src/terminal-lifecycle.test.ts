import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

import { disableAutowrap, hideCursor, showCursor } from "./terminal";

describe("terminal cursor lifecycle", () => {
  test("render is allowed to hide the cursor, but shutdown restores it", () => {
    const renderSource = readFileSync("src/render.ts", "utf8");
    const mainSource = readFileSync("src/main.ts", "utf8");

    expect(renderSource).toContain("hideCursor");
    expect(renderSource).toContain("disableAutowrap");
    expect(hideCursor).toBe("\x1b[?25l");
    expect(disableAutowrap).toBe("\x1b[?7l");
    expect(showCursor).toBe("\x1b[?25h");
    expect(mainSource).toContain("showCursor + enableAutowrap + disableBracketedPaste");
  });
});
