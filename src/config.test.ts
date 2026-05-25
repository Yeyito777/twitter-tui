import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { clearConfig, loadConfig, loadSavedLogins, saveConfig, saveSavedLogins } from "./config";

const previousXdg = process.env.XDG_CONFIG_HOME;

afterEach(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
});

describe("twitter-tui config", () => {
  test("saves sorted saved logins", () => {
    const dir = mkdtempSync(join(tmpdir(), "twitter-tui-config-test-"));
    process.env.XDG_CONFIG_HOME = dir;
    saveSavedLogins({ zed: { auth_token: "z", ct0: "2" }, alice: { auth_token: "a", ct0: "1" } });
    expect(loadSavedLogins()).toEqual({ alice: { auth_token: "a", ct0: "1" }, zed: { auth_token: "z", ct0: "2" } });
    rmSync(dir, { recursive: true, force: true });
  });

  test("clearConfig removes credentials but preserves opener/theme config", () => {
    const dir = mkdtempSync(join(tmpdir(), "twitter-tui-config-test-"));
    process.env.XDG_CONFIG_HOME = dir;
    saveConfig({ auth_token: "old", ct0: "ct0", theme: "whale", openers: { url: { command: "browser", args: ["{target}"] }, rules: [] } });
    clearConfig();
    expect(loadConfig()).toEqual({ theme: "whale", openers: { url: { command: "browser", args: ["{target}"] }, rules: [] } });
    rmSync(dir, { recursive: true, force: true });
  });
});
