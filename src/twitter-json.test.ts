import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

describe("twitter JSON bridge", () => {
  test("thread command accepts a cursor for loading more replies", () => {
    const source = readFileSync("scripts/twitter-json.py", "utf8");
    expect(source).toContain('if args.cursor:\n        variables["cursor"] = args.cursor');
    expect(source).toContain('th.add_argument("-c", "--cursor")');
  });

  test("timeline parsing filters promoted/ad entries before rendering", () => {
    const source = readFileSync("scripts/twitter-json.py", "utf8");
    expect(source).toContain("def filter_promoted_entries(entries):");
    expect(source).toContain('entry_id.startswith("promoted")');
    expect(source).toContain('item.get("promotedMetadata")');
    expect(source).toContain("parse_non_promoted_timeline_entries(entries)");
    expect(source).not.toContain("items, cursors = parse_timeline_entries(entries)");
  });
});
