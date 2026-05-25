import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { cachedFeedForArgs, cachedFeedForArgsAnyAccount, flushTwitterCacheSync, saveFeedForArgs, sidebarSurfaceKeyFromArgs, threadIdFromArgs } from "./datacache";
import type { FeedResult } from "./types";

let tempConfig: string;
let previousXdg: string | undefined;

function feed(id: string): FeedResult {
  return {
    ok: true,
    kind: "timeline",
    title: "Home",
    items: [{ id, name: "Name", handle: "handle", text: `tweet ${id}`, created_at: "", url: "" }],
    cursors: {},
  };
}

beforeEach(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  tempConfig = mkdtempSync(join(tmpdir(), "twitter-tui-cache-test-"));
  process.env.XDG_CONFIG_HOME = tempConfig;
});

afterEach(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  rmSync(tempConfig, { recursive: true, force: true });
});

describe("twitter data cache", () => {
  test("maps sidebar surfaces and threads from args", () => {
    expect(sidebarSurfaceKeyFromArgs(["timeline", "-n", "35"])).toBe("home");
    expect(sidebarSurfaceKeyFromArgs(["timeline", "--latest", "-n", "35"])).toBe("latest");
    expect(sidebarSurfaceKeyFromArgs(["profile", "@Yeyito"])).toBe("profile:yeyito");
    expect(sidebarSurfaceKeyFromArgs(["tweets", "@Yeyito", "-n", "35", "--profile"])).toBe("profile:yeyito");
    expect(sidebarSurfaceKeyFromArgs(["tweets", "@Yeyito", "-n", "35"])).toBeNull();
    expect(sidebarSurfaceKeyFromArgs(["notifications"])).toBe("notifications");
    expect(threadIdFromArgs(["thread", "123"])).toBe("123");
  });

  test("saves and hydrates sidebar surfaces", () => {
    saveFeedForArgs("acct", ["timeline", "-n", "35"], feed("1"));
    const cached = cachedFeedForArgs("acct", ["timeline", "-n", "35"]);
    expect(cached?.feed.items[0]).toMatchObject({ id: "1" });
    expect(cached?.args).toEqual(["timeline", "-n", "35"]);
  });

  test("hydrates from any account while startup account validation is still pending", () => {
    saveFeedForArgs("real-account", ["timeline", "-n", "35"], feed("warm"));
    expect(cachedFeedForArgs("default", ["timeline", "-n", "35"])).toBeNull();
    expect(cachedFeedForArgsAnyAccount(["timeline", "-n", "35"])?.feed.items[0]).toMatchObject({ id: "warm" });
  });

  test("keeps only the last 100 opened thread caches", () => {
    for (let i = 0; i < 105; i++) saveFeedForArgs("acct", ["thread", String(i)], feed(String(i)));
    flushTwitterCacheSync();
    expect(cachedFeedForArgs("acct", ["thread", "104"])?.feed.items[0]).toMatchObject({ id: "104" });
    expect(cachedFeedForArgs("acct", ["thread", "5"])?.feed.items[0]).toMatchObject({ id: "5" });
    expect(cachedFeedForArgs("acct", ["thread", "4"])).toBeNull();

    const json = JSON.parse(readFileSync(join(tempConfig, "twitter-tui", "cache.json"), "utf8"));
    expect(json.accounts.acct.threadOrder).toHaveLength(100);
  });
});
