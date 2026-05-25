import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

describe("timeline profile key", () => {
  test("p opens selected tweet author's profile feed and h returns from profile", () => {
    const source = readFileSync("src/main.ts", "utf8");

    expect(source).toContain("async function openSelectedTweetAuthorProfile()");
    expect(source).toContain('await load(["tweets", handle, "-n", "35", "--profile"], `@${handle}`)');
    expect(source).toContain('case "p": await openSelectedTweetAuthorProfile(); return;');
    expect(source).toContain('case "h": if (state.feedKind === "profile" && goBackToSavedTimeline()) return; moveTimelineCursorCols(state, -1); return;');
    expect(source).toContain('!["thread", "profile"].includes(state.feedKind)');
  });
});
