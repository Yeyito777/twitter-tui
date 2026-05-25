import { describe, expect, test } from "bun:test";
import { COMMAND_LIST, getCommandArgs, splitCommand, tryCommand } from "./commands";
import { createInitialState } from "./state";

describe("slash commands", () => {
  test("only exposes quit/login/logout/theme", () => {
    expect(COMMAND_LIST.map((command) => command.name)).toEqual(["/quit", "/login", "/logout", "/theme"]);
    expect(getCommandArgs(createInitialState())["/theme"].map((item) => item.name)).toContain("whale");
  });

  test("parses shell-like quoted command args", () => {
    expect(splitCommand('login "auth token" ct0')).toEqual(["login", "auth token", "ct0"]);
  });

  test("returns record-style login/logout/theme/quit command results", () => {
    const state = createInitialState();
    expect(tryCommand("/quit", state)).toEqual({ type: "quit" });
    expect(tryCommand("/logout", state)).toEqual({ type: "logout" });
    expect(tryCommand("/login", state)).toEqual({ type: "handled" });
    expect(state.notice.text).toContain("Usage: /login");
    expect(tryCommand("/login saved", state)).toEqual({ type: "login", credential: "saved" });
    expect(tryCommand("/latest", state)).toBeNull();
  });
});
