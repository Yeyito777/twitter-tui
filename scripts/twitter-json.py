#!/usr/bin/env python3
"""Small JSON bridge for twitter-tui.

It reuses the user's twitter-cli credentials/API implementation, but emits the parsed
objects instead of human-formatted text so the Bun TUI can render rich cards.
"""
import argparse
import copy
import json
import os
import sys
import types
from pathlib import Path

TWITTER_CLI_ROOT = Path(os.environ.get(
    "TWITTER_CLI_ROOT",
    str(Path.home() / "Workspace" / "exocortex" / "external-tools" / "twitter-cli"),
))
sys.path.insert(0, str(TWITTER_CLI_ROOT))
TWITTER_CLI_SRC = TWITTER_CLI_ROOT / "src"

# Some launch environments (notably xenv) put their own Python project on
# PYTHONPATH with a real top-level `src` package. twitter-cli is laid out as a
# namespace-style `src/` directory, so force `src.*` imports below to resolve to
# twitter-cli instead of any ambient harness package.
src_pkg = types.ModuleType("src")
src_pkg.__path__ = [str(TWITTER_CLI_SRC)]
sys.modules["src"] = src_pkg

from src.api import graphql_get, rest_get  # type: ignore
from src.helpers import Q, DM_PARAMS, resolve_user_id, format_dm_time, require_tweet_ref  # type: ignore
from src.parse import parse_timeline_entries, parse_tweet  # type: ignore


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))


def timeline_item_content_is_promoted(item):
    if not isinstance(item, dict):
        return False
    if item.get("promotedMetadata") or item.get("promoted_metadata"):
        return True
    metadata = item.get("promotedMetadata", {})
    if isinstance(metadata, dict) and (metadata.get("advertiser_results") or metadata.get("adMetadataContainer")):
        return True
    return False


def client_event_is_promoted(container):
    if not isinstance(container, dict):
        return False
    info = container.get("clientEventInfo", {})
    if not isinstance(info, dict):
        return False
    component = str(info.get("component", "")).lower()
    if "promoted" in component:
        return True
    timelines = info.get("details", {}).get("timelinesDetails", {}) if isinstance(info.get("details"), dict) else {}
    injection_type = str(timelines.get("injectionType", "")).lower() if isinstance(timelines, dict) else ""
    return "promoted" in injection_type


def timeline_entry_is_promoted(entry):
    entry_id = str(entry.get("entryId", "")).lower()
    if entry_id.startswith("promoted") or "promoted-tweet" in entry_id:
        return True
    content = entry.get("content", {})
    if client_event_is_promoted(content):
        return True
    return timeline_item_content_is_promoted(content.get("itemContent", {}))


def timeline_module_item_is_promoted(item_wrapper):
    if client_event_is_promoted(item_wrapper):
        return True
    item = item_wrapper.get("item", {}) if isinstance(item_wrapper, dict) else {}
    if client_event_is_promoted(item):
        return True
    return timeline_item_content_is_promoted(item.get("itemContent", {}) if isinstance(item, dict) else {})


def filter_promoted_entries(entries):
    """Remove promoted/ad timeline entries before parsing."""
    filtered = []
    for entry in entries:
        if timeline_entry_is_promoted(entry):
            continue
        content = entry.get("content", {})
        if content.get("__typename") == "TimelineTimelineModule":
            items = content.get("items", [])
            clean_items = [item for item in items if not timeline_module_item_is_promoted(item)]
            if len(clean_items) != len(items):
                if not clean_items:
                    continue
                entry = copy.deepcopy(entry)
                entry["content"]["items"] = clean_items
        filtered.append(entry)
    return filtered


def parse_non_promoted_timeline_entries(entries):
    return parse_timeline_entries(filter_promoted_entries(entries))


def account(args):
    data = rest_get("/1.1/account/verify_credentials.json")
    emit({
        "ok": True,
        "kind": "account",
        "account": {
            "id": data.get("id_str") or str(data.get("id", "")),
            "name": data.get("name", ""),
            "handle": data.get("screen_name", ""),
            "followers": data.get("followers_count", 0),
        },
    })


def timeline(args):
    variables = {
        "count": args.count,
        "includePromotedContent": False,
        "requestContext": "launch",
        "withCommunity": True,
    }
    if args.cursor:
        variables["cursor"] = args.cursor
    op = "HomeLatestTimeline" if args.latest else "HomeTimeline"
    data = graphql_get(Q[op], op, variables)
    entries = data["data"]["home"]["home_timeline_urt"]["instructions"][0]["entries"]
    items, cursors = parse_non_promoted_timeline_entries(entries)
    emit({"ok": True, "kind": "timeline", "title": "Latest" if args.latest else "Home", "items": items, "cursors": cursors})


def search(args):
    query = " ".join(args.query)
    variables = {
        "rawQuery": query,
        "count": args.count,
        "querySource": "typed_query",
        "product": "Latest" if args.latest else "Top",
    }
    if args.cursor:
        variables["cursor"] = args.cursor
    data = graphql_get(Q["SearchTimeline"], "SearchTimeline", variables)
    instructions = data.get("data", {}).get("search_by_raw_query", {}).get("search_timeline", {}).get("timeline", {}).get("instructions", [])
    entries = []
    for inst in instructions:
        if inst.get("type") == "TimelineAddEntries":
            entries = inst.get("entries", [])
            break
    items, cursors = parse_non_promoted_timeline_entries(entries)
    emit({"ok": True, "kind": "search", "title": f"Search: {query}", "items": items, "cursors": cursors, "query": query})


def profile_payload_for_screen_name(screen_name):
    data = graphql_get(Q["UserByScreenName"], "UserByScreenName", {"screen_name": screen_name, "withSafetyModeUserFields": True})
    user = data.get("data", {}).get("user", {}).get("result", {})
    core = user.get("core", {})
    legacy = user.get("legacy", {})
    return {
        "id": user.get("rest_id", ""),
        "name": core.get("name") or legacy.get("name", "?"),
        "handle": core.get("screen_name") or legacy.get("screen_name", screen_name),
        "bio": user.get("profile_bio", {}).get("description", "") or legacy.get("description", ""),
        "location": user.get("location", {}).get("location", "") or legacy.get("location", ""),
        "created_at": core.get("created_at", ""),
        "followers": legacy.get("followers_count", 0),
        "following": legacy.get("friends_count", 0),
        "tweets": legacy.get("statuses_count", 0),
        "verified": user.get("is_blue_verified", False),
        "url": f"https://x.com/{screen_name}",
    }


def user_tweets(args):
    screen_name = args.user.lstrip("@")
    user_id, _ = resolve_user_id(screen_name)
    variables = {
        "userId": user_id,
        "count": args.count,
        "includePromotedContent": False,
        "withQuickPromoteEligibilityTweetFields": True,
        "withVoice": True,
        "withV2Timeline": True,
    }
    if args.cursor:
        variables["cursor"] = args.cursor
    op = "UserTweetsAndReplies" if args.replies else "UserTweets"
    data = graphql_get(Q[op], op, variables)
    instructions = data.get("data", {}).get("user", {}).get("result", {}).get("timeline", {}).get("timeline", {}).get("instructions", [])
    entries = []
    for inst in instructions:
        if inst.get("type") == "TimelineAddEntries":
            entries = inst.get("entries", [])
            break
    items, cursors = parse_non_promoted_timeline_entries(entries)
    payload = {"ok": True, "kind": "user", "title": f"@{screen_name}", "items": items, "cursors": cursors, "user": screen_name}
    if getattr(args, "profile", False):
        payload["kind"] = "profile"
        payload["profile"] = profile_payload_for_screen_name(screen_name)
    emit(payload)


def single_tweet(args):
    tweet_id = require_tweet_ref(args.tweet)
    variables = {"tweetId": tweet_id, "withCommunity": True, "includePromotedContent": False, "withVoice": True}
    data = graphql_get(Q["TweetResultByRestId"], "TweetResultByRestId", variables)
    result = data.get("data", {}).get("tweetResult", {}).get("result")
    tweet = parse_tweet(result)
    emit({"ok": True, "kind": "tweet", "title": f"Tweet {tweet_id}", "items": [tweet] if tweet else [], "cursors": {}})


def thread(args):
    tweet_id = require_tweet_ref(args.tweet)
    variables = {
        "focalTweetId": tweet_id,
        "with_rux_injections": False,
        "includePromotedContent": False,
        "withCommunity": True,
        "withQuickPromoteEligibilityTweetFields": True,
        "withBirdwatchNotes": True,
        "withVoice": True,
        "withV2Timeline": True,
    }
    if args.cursor:
        variables["cursor"] = args.cursor
    data = graphql_get(Q["TweetDetail"], "TweetDetail", variables)
    instructions = data.get("data", {}).get("threaded_conversation_with_injections_v2", {}).get("instructions", [])
    entries = []
    for inst in instructions:
        if inst.get("type") == "TimelineAddEntries":
            entries = inst.get("entries", [])
            break
    items, cursors = parse_non_promoted_timeline_entries(entries)
    emit({"ok": True, "kind": "thread", "title": f"Thread {tweet_id}", "items": items, "cursors": cursors})


def notifications(args):
    variables = {"timeline_type": "All", "count": args.count}
    if args.cursor:
        variables["cursor"] = args.cursor
    data = graphql_get(Q["NotificationsTimeline"], "NotificationsTimeline", variables)
    instructions = data.get("data", {}).get("viewer_v2", {}).get("user_results", {}).get("result", {}).get("notification_timeline", {}).get("timeline", {}).get("instructions", [])
    entries = []
    for inst in instructions:
        if inst.get("type") == "TimelineAddEntries":
            entries = inst.get("entries", [])
            break
    items, cursors = parse_non_promoted_timeline_entries(entries)
    emit({"ok": True, "kind": "notifications", "title": "Notifications", "items": items, "cursors": cursors})


def bookmarks(args):
    variables = {"count": args.count, "includePromotedContent": False}
    if args.cursor:
        variables["cursor"] = args.cursor
    data = graphql_get(Q["Bookmarks"], "Bookmarks", variables)
    instructions = data.get("data", {}).get("bookmark_timeline_v2", {}).get("timeline", {}).get("instructions", [])
    entries = []
    for inst in instructions:
        if inst.get("type") == "TimelineAddEntries":
            entries = inst.get("entries", [])
            break
    items, cursors = parse_non_promoted_timeline_entries(entries)
    emit({"ok": True, "kind": "bookmarks", "title": "Bookmarks", "items": items, "cursors": cursors})


def trending(args):
    data = graphql_get(Q["ExplorePage"], "ExplorePage", {"count": 20, "includePromotedContent": False})
    timelines = data.get("data", {}).get("explore_page", {}).get("body", {}).get("timelines", [])
    trending_id = None
    for t in timelines:
        if t.get("id") == "trending":
            trending_id = t.get("timeline", {}).get("id")
            break
    if not trending_id:
        emit({"ok": True, "kind": "trending", "title": "Trending", "items": [], "cursors": {}})
        return
    data = graphql_get(Q["GenericTimelineById"], "GenericTimelineById", {"timelineId": trending_id, "count": args.count, "withQuickPromoteEligibilityTweetFields": True})
    instructions = data.get("data", {}).get("timeline", {}).get("timeline", {}).get("instructions", [])
    entries = []
    for inst in instructions:
        if inst.get("type") == "TimelineAddEntries":
            entries = inst.get("entries", [])
            break
    items, cursors = parse_non_promoted_timeline_entries(entries)
    emit({"ok": True, "kind": "trending", "title": "Trending", "items": items, "cursors": cursors})


def profile(args):
    screen_name = args.user.lstrip("@")
    profile_payload = profile_payload_for_screen_name(screen_name)
    emit({"ok": True, "kind": "profile", "title": f"@{profile_payload['handle']}", "profile": profile_payload, "items": [], "cursors": {}})


def dms(args):
    data = rest_get("/1.1/dm/inbox_initial_state.json", DM_PARAMS)
    inbox = data.get("inbox_initial_state", {})
    users = inbox.get("users", {})
    convos = inbox.get("conversations", {})
    entries = inbox.get("entries", [])
    user_map = {uid: {"id": uid, "name": u.get("name", uid), "handle": u.get("screen_name", uid)} for uid, u in users.items()}
    last_msg = {}
    for entry in entries:
        msg = entry.get("message", {})
        conv_id = msg.get("conversation_id", "")
        md = msg.get("message_data", {})
        time_ms = msg.get("time", "0")
        if conv_id and (conv_id not in last_msg or int(time_ms or 0) > int(last_msg[conv_id]["time"] or 0)):
            last_msg[conv_id] = {"sender": md.get("sender_id", ""), "text": md.get("text", ""), "time": time_ms}
    results = []
    for conv_id, conv in convos.items():
        participants = [user_map[pt["user_id"]] for pt in conv.get("participants", []) if pt.get("user_id") in user_map]
        lm = last_msg.get(conv_id, {})
        results.append({
            "type": "dm_conversation",
            "id": conv_id,
            "participants": participants,
            "last_message": lm.get("text", ""),
            "last_sender": user_map.get(lm.get("sender", ""), {}).get("handle", "?"),
            "last_time": format_dm_time(lm.get("time", "")),
            "conversation_type": conv.get("type", ""),
        })
    results.sort(key=lambda r: r.get("last_time", ""), reverse=True)
    emit({"ok": True, "kind": "dms", "title": "Direct Messages", "items": results, "cursors": {}})


def dm(args):
    conv_ref = args.conversation
    if not conv_ref.replace("-", "").isdigit():
        user_id, _ = resolve_user_id(conv_ref)
        inbox = rest_get("/1.1/dm/inbox_initial_state.json", DM_PARAMS).get("inbox_initial_state", {})
        for cid, conv in inbox.get("conversations", {}).items():
            if user_id in [pt.get("user_id") for pt in conv.get("participants", [])]:
                conv_ref = cid
                break
    data = rest_get(f"/1.1/dm/conversation/{conv_ref}.json", DM_PARAMS)
    conv = data.get("conversation_timeline", {})
    entries = conv.get("entries", [])
    users = conv.get("users", {})
    user_map = {uid: {"id": uid, "name": u.get("name", uid), "handle": u.get("screen_name", uid)} for uid, u in users.items()}
    messages = []
    for entry in entries:
        msg = entry.get("message", {})
        md = msg.get("message_data", {})
        if not md:
            continue
        sender_id = md.get("sender_id", "")
        messages.append({
            "type": "dm_message",
            "id": msg.get("id", ""),
            "sender": user_map.get(sender_id, {"id": sender_id, "handle": sender_id, "name": sender_id}),
            "text": md.get("text", ""),
            "time": format_dm_time(msg.get("time", "")),
            "conversation_id": conv_ref,
        })
    messages.reverse()
    title = "DM"
    handles = [f"@{u['handle']}" for u in user_map.values()]
    if handles:
        title = "DM " + " & ".join(handles[:3])
    emit({"ok": True, "kind": "dm", "title": title, "conversation_id": conv_ref, "items": messages, "cursors": {}})


def main():
    p = argparse.ArgumentParser(prog="twitter-json.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    tl = sub.add_parser("timeline"); tl.add_argument("-n", "--count", type=int, default=30); tl.add_argument("-c", "--cursor"); tl.add_argument("-l", "--latest", action="store_true"); tl.set_defaults(fn=timeline)
    se = sub.add_parser("search"); se.add_argument("query", nargs="+"); se.add_argument("-n", "--count", type=int, default=30); se.add_argument("-c", "--cursor"); se.add_argument("-l", "--latest", action="store_true"); se.set_defaults(fn=search)
    tws = sub.add_parser("tweets"); tws.add_argument("user"); tws.add_argument("-n", "--count", type=int, default=30); tws.add_argument("-c", "--cursor"); tws.add_argument("--replies", action="store_true"); tws.add_argument("--profile", action="store_true"); tws.set_defaults(fn=user_tweets)
    t = sub.add_parser("tweet"); t.add_argument("tweet"); t.set_defaults(fn=single_tweet)
    th = sub.add_parser("thread"); th.add_argument("tweet"); th.add_argument("-c", "--cursor"); th.set_defaults(fn=thread)
    no = sub.add_parser("notifications"); no.add_argument("-n", "--count", type=int, default=30); no.add_argument("-c", "--cursor"); no.set_defaults(fn=notifications)
    bm = sub.add_parser("bookmarks"); bm.add_argument("-n", "--count", type=int, default=30); bm.add_argument("-c", "--cursor"); bm.set_defaults(fn=bookmarks)
    tr = sub.add_parser("trending"); tr.add_argument("-n", "--count", type=int, default=30); tr.set_defaults(fn=trending)
    pr = sub.add_parser("profile"); pr.add_argument("user"); pr.set_defaults(fn=profile)
    ds = sub.add_parser("dms"); ds.set_defaults(fn=dms)
    d = sub.add_parser("dm"); d.add_argument("conversation"); d.set_defaults(fn=dm)
    ac = sub.add_parser("account"); ac.set_defaults(fn=account)
    args = p.parse_args()
    try:
        args.fn(args)
    except Exception as exc:
        emit({"ok": False, "error": str(exc), "cmd": args.cmd})
        sys.exit(1)


if __name__ == "__main__":
    main()
