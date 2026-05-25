import { describe, expect, test } from "bun:test";
import { COMMAND_LIST, getCommandArgs, splitCommand, tryCommand } from "./commands";
import { createInitialState } from "./state";

describe("slash commands", () => {
  test("exposes command list and theme args for autocomplete", () => {
    expect(COMMAND_LIST.map((command) => command.name)).toContain("/thread");
    expect(getCommandArgs(createInitialState())["/theme"].map((item) => item.name)).toContain("whale");
  });

  test("parses shell-like quoted command args", () => {
    expect(splitCommand('search "hello world" now')).toEqual(["search", "hello world", "now"]);
  });

  test("returns structured command results", () => {
    const state = createInitialState();
    expect(tryCommand("/latest", state)).toEqual({ type: "load", args: ["timeline", "--latest", "-n", "35"], title: "Latest" });
    expect(tryCommand("/thread", state)).toEqual({ type: "handled" });
    expect(state.notice.text).toContain("Usage: /thread");
  });
});
