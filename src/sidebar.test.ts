import { describe, expect, test } from "bun:test";
import { VIEWS } from "./state";

describe("sidebar views", () => {
  test("shows profile instead of latest and trends", () => {
    expect(VIEWS.map((view) => view.id)).toEqual(["home", "profile", "notifications", "bookmarks", "dms"]);
    expect(VIEWS.map((view) => view.label)).toEqual(["Home", "Profile", "Notifs", "Bookmarks", "DMs"]);
  });
});
