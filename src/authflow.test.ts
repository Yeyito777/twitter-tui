import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { loadConfig, loadSavedLogins, saveConfig } from "./config";
import { logoutCredentials, parseCredentialPair, resolveLoginCredential, saveValidatedLogin } from "./authflow";
import type { Account } from "./types";

let tempConfig: string;
let previousXdg: string | undefined;

beforeEach(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  tempConfig = mkdtempSync(join(tmpdir(), "twitter-tui-authflow-test-"));
  process.env.XDG_CONFIG_HOME = tempConfig;
});

afterEach(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  rmSync(tempConfig, { recursive: true, force: true });
});

describe("twitter auth flow", () => {
  test("parses pasted credentials like cookies/json/pair", () => {
    expect(parseCredentialPair("auth ct0")).toEqual({ auth_token: "auth", ct0: "ct0" });
    expect(parseCredentialPair("auth_token=aaa; ct0=ccc")).toEqual({ auth_token: "aaa", ct0: "ccc" });
    expect(parseCredentialPair('{"auth_token":"a","ct0":"c"}')).toEqual({ auth_token: "a", ct0: "c" });
  });

  test("resolves saved login names", () => {
    expect(resolveLoginCredential({ alice: { auth_token: "a", ct0: "c" } }, "alice")).toEqual({ auth_token: "a", ct0: "c" });
  });

  test("saving validated login preserves record-style saved login map", () => {
    const account: Account = { id: "1", name: "Alice", handle: "alice", followers: 1 };
    const saved = saveValidatedLogin({}, account, { auth_token: "a", ct0: "c" });
    expect(saved).toEqual({ alice: { auth_token: "a", ct0: "c" } });
    expect(loadSavedLogins()).toEqual(saved);
  });

  test("logout clears only credentials and preserves opener config", () => {
    saveConfig({ auth_token: "a", ct0: "c", openers: { url: { command: "browser", args: ["{target}"] }, rules: [] } });
    logoutCredentials();
    expect(loadConfig()).toEqual({ openers: { url: { command: "browser", args: ["{target}"] }, rules: [] } });
  });
});
