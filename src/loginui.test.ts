import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

describe("login switching UI", () => {
  test("does not render validating credentials text in the prompt context", () => {
    const source = readFileSync("src/main.ts", "utf8");
    expect(source).not.toContain("Validating Twitter credentials");
  });
});
