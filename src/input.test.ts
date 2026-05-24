import { describe, expect, test } from "bun:test";
import { parseInput } from "./input";

describe("parseInput", () => {
  test("drops OSC title/control strings instead of leaking them as prompt text", () => {
    expect(parseInput("\x1b]0;/bin/twitter-tui\x07a")).toEqual([{ type: "char", char: "a" }]);
    expect(parseInput("\x1b]0;/bin/twitter-tui\x1b\\b")).toEqual([{ type: "char", char: "b" }]);
  });
});
