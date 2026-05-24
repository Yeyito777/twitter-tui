export type FeedKind =
  | "home"
  | "latest"
  | "search"
  | "user"
  | "tweet"
  | "thread"
  | "notifications"
  | "bookmarks"
  | "trending"
  | "profile"
  | "dms"
  | "dm";

export interface TweetItem {
  id: string;
  name: string;
  handle: string;
  text: string;
  created_at: string;
  lang?: string;
  likes?: number | string;
  retweets?: number | string;
  replies?: number | string;
  quotes?: number | string;
  bookmarks?: number | string;
  views?: number | string;
  is_retweet?: boolean;
  is_quote?: boolean;
  is_reply?: boolean;
  in_reply_to?: string | null;
  in_reply_to_id?: string | null;
  media?: Array<{ type: string; url: string; expanded_url?: string }>;
  url: string;
  retweeted?: TweetItem | null;
  quoted?: TweetItem | null;
}

export interface NotificationItem {
  type: "notification";
  icon: string;
  icon_name?: string;
  message: string;
  url?: string;
  created_at?: string;
  id: string;
}

export interface TrendItem {
  type: "trend";
  name: string;
  rank?: string | number;
  domain?: string;
  description?: string;
}

export interface DmConversationItem {
  type: "dm_conversation";
  id: string;
  participants: Array<{ id: string; name: string; handle: string }>;
  last_message: string;
  last_sender: string;
  last_time: string;
  conversation_type?: string;
}

export interface DmMessageItem {
  type: "dm_message";
  id: string;
  sender: { id: string; name: string; handle: string };
  text: string;
  time: string;
  conversation_id: string;
}

export interface Profile {
  id: string;
  name: string;
  handle: string;
  bio: string;
  location: string;
  created_at: string;
  followers: number;
  following: number;
  tweets: number;
  verified: boolean;
  url: string;
}

export interface Account {
  id: string;
  name: string;
  handle: string;
  followers: number;
}

export type TimelineItem = TweetItem | NotificationItem | TrendItem | DmConversationItem | DmMessageItem;

export interface FeedResult {
  ok: true;
  kind: FeedKind | string;
  title: string;
  items: TimelineItem[];
  cursors: { top?: string; bottom?: string };
  query?: string;
  user?: string;
  conversation_id?: string;
  profile?: Profile;
}

export interface AccountResult {
  ok: true;
  kind: "account";
  account: Account;
}

export interface BackendErrorResult {
  ok: false;
  error: string;
  cmd?: string;
}

export type BackendResult = FeedResult | AccountResult | BackendErrorResult;

export function isTweet(item: TimelineItem | null | undefined): item is TweetItem {
  return Boolean(item && !("type" in item));
}

export function isNotification(item: TimelineItem | null | undefined): item is NotificationItem {
  return Boolean(item && "type" in item && item.type === "notification");
}

export function isTrend(item: TimelineItem | null | undefined): item is TrendItem {
  return Boolean(item && "type" in item && item.type === "trend");
}

export function isDmConversation(item: TimelineItem | null | undefined): item is DmConversationItem {
  return Boolean(item && "type" in item && item.type === "dm_conversation");
}

export function isDmMessage(item: TimelineItem | null | undefined): item is DmMessageItem {
  return Boolean(item && "type" in item && item.type === "dm_message");
}
