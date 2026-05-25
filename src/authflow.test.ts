import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { loadConfig, loadSavedLogins, saveConfig } from "./config";
import { loadConfiguredCredentials, logoutCredentials, parseCredentialPair, resolveLoginCredential, saveValidatedLogin, twitterCliCredentialsFile, writeTwitterCliCredentials } from "./authflow";
import type { Account } from "./types";

let tempConfig: string;
let tempCliRoot: string;
let previousXdg: string | undefined;
let previousCliRoot: string | undefined;

beforeEach(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  previousCliRoot = process.env.TWITTER_TUI_TWITTER_CLI_ROOT;
  tempConfig = mkdtempSync(join(tmpdir(), "twitter-tui-authflow-test-"));
  tempCliRoot = mkdtempSync(join(tmpdir(), "twitter-tui-cli-root-test-"));
  process.env.XDG_CONFIG_HOME = tempConfig;
  process.env.TWITTER_TUI_TWITTER_CLI_ROOT = tempCliRoot;
});

afterEach(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  if (previousCliRoot === undefined) delete process.env.TWITTER_TUI_TWITTER_CLI_ROOT;
  else process.env.TWITTER_TUI_TWITTER_CLI_ROOT = previousCliRoot;
  rmSync(tempConfig, { recursive: true, force: true });
  rmSync(tempCliRoot, { recursive: true, force: true });
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
    expect(JSON.parse(readFileSync(twitterCliCredentialsFile(), "utf8"))).toEqual({ auth_token: "a", ct0: "c" });
  });

  test("saving validated login repairs stale/mislabeled saved-login entries with same credentials", () => {
    const account: Account = { id: "2", name: "Paramount", handle: "im_paramount", followers: 0 };
    const saved = saveValidatedLogin({ im_yeyito: { auth_token: "p", ct0: "c" } }, account, { auth_token: "p", ct0: "c" });
    expect(saved).toEqual({ im_paramount: { auth_token: "p", ct0: "c" } });
    expect(loadSavedLogins()).toEqual(saved);
  });

  test("writes real twitter-cli credentials path and removes stale shadow credentials", () => {
    const shadow = join(tempCliRoot, "src", "config", "credentials.json");
    mkdirSync(join(tempCliRoot, "src", "config"), { recursive: true });
    writeFileSync(shadow, JSON.stringify({ auth_token: "old", ct0: "old" }), { mode: 0o600 });

    writeTwitterCliCredentials({ auth_token: "new", ct0: "fresh" });

    expect(twitterCliCredentialsFile()).toBe(join(tempCliRoot, "config", "credentials.json"));
    expect(JSON.parse(readFileSync(twitterCliCredentialsFile(), "utf8"))).toEqual({ auth_token: "new", ct0: "fresh" });
    expect(existsSync(shadow)).toBe(false);
  });

  test("loads configured credentials for startup sync", () => {
    saveConfig({ auth_token: "cfg-auth", ct0: "cfg-ct0" });
    expect(loadConfiguredCredentials()).toEqual({ auth_token: "cfg-auth", ct0: "cfg-ct0" });
  });

  test("logout clears only credentials and preserves opener config", () => {
    saveConfig({ auth_token: "a", ct0: "c", openers: { url: { command: "browser", args: ["{target}"] }, rules: [] } });
    logoutCredentials();
    expect(loadConfig()).toEqual({ openers: { url: { command: "browser", args: ["{target}"] }, rules: [] } });
  });
});
