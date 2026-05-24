import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { defaultOpenersConfig, configPath } from "./config";
import { findOpenableTargetMatches, resolveOpenCommand } from "./openable";

let tempConfig: string;
let previousXdg: string | undefined;

beforeEach(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  tempConfig = mkdtempSync(join(tmpdir(), "twitter-tui-openable-test-"));
  process.env.XDG_CONFIG_HOME = tempConfig;
});

afterEach(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  rmSync(tempConfig, { recursive: true, force: true });
});

describe("openable config", () => {
  test("default config is cloned from record-style openers", () => {
    const defaults = defaultOpenersConfig();
    expect(defaults.url).toEqual({ command: "xdg-open", args: ["{target}"] });
    expect(defaults.rules?.some((rule) => rule.extensions.includes("png") && rule.command === "show")).toBe(true);
  });

  test("finds URLs and configured file paths", () => {
    const matches = findOpenableTargetMatches("see https://example.com/a.png and ~/notes/test.md");
    expect(matches.map((match) => match.target)).toEqual(["https://example.com/a.png", "~/notes/test.md"]);
  });

  test("resolves commands from user config with templates", () => {
    mkdirSync(join(tempConfig, "twitter-tui"), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({
      openers: {
        url: { command: "echo", args: ["url={target}"] },
        rules: [{ extensions: ["txt"], command: "cat", args: ["{path}"] }],
      },
    }));
    expect(resolveOpenCommand("https://x.com/u/status/1")).toEqual({ command: "echo", args: ["url=https://x.com/u/status/1"] });
    expect(resolveOpenCommand("~/foo.txt")?.command).toBe("cat");
  });
});
