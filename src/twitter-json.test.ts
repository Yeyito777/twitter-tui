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

  test("profile timeline mode fetches user tweets plus profile metadata", () => {
    const source = readFileSync("scripts/twitter-json.py", "utf8");
    expect(source).toContain('tws.add_argument("--profile", action="store_true")');
    expect(source).toContain('if getattr(args, "profile", False):');
    expect(source).toContain('payload["kind"] = "profile"');
    expect(source).toContain('payload["profile"] = profile_payload_for_screen_name(screen_name)');
  });
});
