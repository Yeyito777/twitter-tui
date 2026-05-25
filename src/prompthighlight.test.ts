import { describe, expect, test } from "bun:test";
import { highlightPromptViewport } from "./prompthighlight";
import { createInitialState } from "./state";
import { theme } from "./theme";

describe("prompt command highlight", () => {
  test("colors known slash commands with command color", () => {
    const state = createInitialState();
    const rendered = highlightPromptViewport("/theme whale", "/theme whale", 0, state);
    expect(rendered).toContain(theme.command);
    expect(rendered).toContain("/theme");
    expect(rendered).toContain("whale");
  });

  test("does not color unknown commands", () => {
    const state = createInitialState();
    const rendered = highlightPromptViewport("/doesnotexist", "/doesnotexist", 0, state);
    expect(rendered).not.toContain(theme.command);
  });
});
