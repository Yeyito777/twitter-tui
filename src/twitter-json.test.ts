import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

describe("twitter JSON bridge", () => {
  test("thread command accepts a cursor for loading more replies", () => {
    const source = readFileSync("scripts/twitter-json.py", "utf8");
    expect(source).toContain('if args.cursor:\n        variables["cursor"] = args.cursor');
    expect(source).toContain('th.add_argument("-c", "--cursor")');
  });
});
