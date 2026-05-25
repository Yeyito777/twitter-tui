import { describe, expect, test } from "bun:test";
import { feedArgsForView } from "./backend";
import { isDmConversation, isNotification, isTrend, isTweet, type TimelineItem } from "./types";

describe("feedArgsForView", () => {
  test("maps built-in sidebar views to bridge commands", () => {
    expect(feedArgsForView("home")).toEqual(["timeline", "-n", "35"]);
    expect(feedArgsForView("notifications")).toEqual(["notifications", "-n", "35"]);
    expect(feedArgsForView("bookmarks")).toEqual(["bookmarks", "-n", "35"]);
    expect(feedArgsForView("dms")).toEqual(["dms"]);
  });
});

describe("timeline item guards", () => {
  test("distinguish tweets from typed synthetic items", () => {
    const tweet: TimelineItem = { id: "1", name: "A", handle: "a", text: "hello", created_at: "2026-05-23 12:00", url: "https://x.com/a/status/1" };
    const notif: TimelineItem = { type: "notification", id: "n", icon: "♥", message: "liked", url: "", created_at: "" };
    const trend: TimelineItem = { type: "trend", name: "Bun", rank: 1, domain: "Tech", description: "fast" };
    const dm: TimelineItem = { type: "dm_conversation", id: "c", participants: [], last_message: "yo", last_sender: "me", last_time: "now" };
    expect(isTweet(tweet)).toBe(true);
    expect(isNotification(notif)).toBe(true);
    expect(isTrend(trend)).toBe(true);
    expect(isDmConversation(dm)).toBe(true);
  });
});
