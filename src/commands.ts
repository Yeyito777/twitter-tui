/** Slash command registry and completion metadata, ported from record's command UX. */

import { saveConfig } from "./config";
import type { AppState } from "./state";
import { setNotice } from "./state";
import { setTheme, theme, THEME_NAMES, type ThemeName } from "./theme";

export interface CompletionItem {
  name: string;
  desc: string;
  color?: string;
}

export type CommandResult =
  | { type: "handled" }
  | { type: "quit" }
  | { type: "refresh" }
  | { type: "open"; target?: string }
  | { type: "load"; args: string[]; title: string }
  | { type: "action"; label: string; args: string[]; refresh?: boolean };

export interface SlashCommand {
  name: string;
  description: string;
  args?: CompletionItem[];
  getArgs?: (state: AppState) => Record<string, CompletionItem[]>;
  handler: (text: string, state: AppState) => CommandResult;
}

export function splitCommand(input: string): string[] {
  const parts: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) parts.push(match[1] ?? match[2] ?? match[3] ?? "");
  return parts;
}

function clearPrompt(state: AppState): void {
  state.editor.buffer = "";
  state.editor.cursor = 0;
  state.editor.visualAnchor = 0;
  state.editor.mode = "insert";
  state.autocomplete = null;
}

function usage(state: AppState, text: string): CommandResult {
  setNotice(state, text, "warning");
  clearPrompt(state);
  return { type: "handled" };
}

function selectedTweetId(state: AppState): string | null {
  const item = state.items[state.selectedIndex];
  if (!item || !("id" in item) || !("text" in item)) return null;
  return item.id;
}

const USER_ARGS: CompletionItem[] = [
  { name: "@handle", desc: "Twitter/X handle" },
];

const ID_ARGS: CompletionItem[] = [
  { name: "tweet-id", desc: "Tweet id or URL" },
];

const VIEW_ARGS: CompletionItem[] = [
  { name: "home", desc: "Algorithmic timeline" },
  { name: "latest", desc: "Chronological timeline" },
  { name: "notifs", desc: "Notifications" },
  { name: "bookmarks", desc: "Saved tweets" },
  { name: "trends", desc: "Trending topics" },
  { name: "dms", desc: "Direct messages" },
];

const commands: SlashCommand[] = [
  {
    name: "/help",
    description: "Show available commands",
    handler: (_text, state) => {
      const lines = commands
        .filter((command) => command.name !== "/exit")
        .map((command) => `${command.name}  ${command.description}`);
      setNotice(state, lines.join("\n"), "muted");
      clearPrompt(state);
      return { type: "handled" };
    },
  },
  { name: "/quit", description: "Exit twitter-tui", handler: () => ({ type: "quit" }) },
  { name: "/exit", description: "Exit twitter-tui", handler: () => ({ type: "quit" }) },
  { name: "/refresh", description: "Refresh the current timeline", handler: () => ({ type: "refresh" }) },
  { name: "/home", description: "Open Home timeline", handler: () => ({ type: "load", args: ["timeline", "-n", "35"], title: "Home" }) },
  { name: "/latest", description: "Open Latest timeline", handler: () => ({ type: "load", args: ["timeline", "--latest", "-n", "35"], title: "Latest" }) },
  { name: "/notifications", description: "Open notifications", handler: () => ({ type: "load", args: ["notifications", "-n", "35"], title: "Notifications" }) },
  { name: "/notifs", description: "Open notifications", handler: () => ({ type: "load", args: ["notifications", "-n", "35"], title: "Notifications" }) },
  { name: "/bookmarks", description: "Open bookmarks", handler: () => ({ type: "load", args: ["bookmarks", "-n", "35"], title: "Bookmarks" }) },
  { name: "/bms", description: "Open bookmarks", handler: () => ({ type: "load", args: ["bookmarks", "-n", "35"], title: "Bookmarks" }) },
  { name: "/trends", description: "Open trends", handler: () => ({ type: "load", args: ["trending", "-n", "35"], title: "Trending" }) },
  { name: "/trending", description: "Open trends", handler: () => ({ type: "load", args: ["trending", "-n", "35"], title: "Trending" }) },
  { name: "/dms", description: "Open direct messages", handler: () => ({ type: "load", args: ["dms"], title: "DMs" }) },
  {
    name: "/search",
    description: "Search tweets",
    args: [{ name: "query", desc: "Search query" }],
    handler: (text, state) => {
      const parts = splitCommand(text.slice(1));
      const query = text.trim().slice((parts[0] ?? "search").length + 2).trim();
      if (!query) return usage(state, "Usage: /search <query>");
      return { type: "load", args: ["search", "-n", "35", ...splitCommand(query)], title: "Search" };
    },
  },
  {
    name: "/user",
    description: "Open a user's tweets",
    args: USER_ARGS,
    handler: (text, state) => {
      const [, handle] = splitCommand(text.slice(1));
      if (!handle) return usage(state, "Usage: /user @handle");
      return { type: "load", args: ["tweets", handle, "-n", "35"], title: `@${handle.replace(/^@/, "")}` };
    },
  },
  {
    name: "/profile",
    description: "Open a user's profile",
    args: USER_ARGS,
    handler: (text, state) => {
      const [, handle] = splitCommand(text.slice(1));
      if (!handle) return usage(state, "Usage: /profile @handle");
      return { type: "load", args: ["profile", handle], title: `@${handle.replace(/^@/, "")}` };
    },
  },
  {
    name: "/tweet",
    description: "Open a tweet by id or URL",
    args: ID_ARGS,
    handler: (text, state) => {
      const [, id] = splitCommand(text.slice(1));
      if (!id) return usage(state, "Usage: /tweet <id|url>");
      return { type: "load", args: ["tweet", id], title: "Tweet" };
    },
  },
  {
    name: "/thread",
    description: "Open selected tweet's thread or a tweet id/URL",
    args: ID_ARGS,
    handler: (text, state) => {
      const [, idArg] = splitCommand(text.slice(1));
      const id = idArg ?? selectedTweetId(state);
      if (!id) return usage(state, "Usage: /thread <id|url> or select a tweet");
      return { type: "load", args: ["thread", id], title: "Thread" };
    },
  },
  {
    name: "/dm",
    description: "Open or send a DM",
    args: [{ name: "conversation-or-@user", desc: "Conversation id or handle" }],
    handler: (text, state) => {
      const [, id] = splitCommand(text.slice(1));
      if (!id) return usage(state, "Usage: /dm <conversation-id|@handle>");
      return { type: "load", args: ["dm", id], title: "DM" };
    },
  },
  {
    name: "/post",
    description: "Post a tweet",
    args: [{ name: "text", desc: "Tweet text" }],
    handler: (text, state) => {
      const rest = text.replace(/^\/post\s*/, "").trim();
      if (!rest) return usage(state, "Usage: /post <text>");
      return { type: "action", label: "Posting", args: ["post", rest], refresh: true };
    },
  },
  {
    name: "/reply",
    description: "Reply to selected tweet or id",
    args: [{ name: "text", desc: "Reply text" }],
    handler: (text, state) => {
      const [, first, ...rest] = splitCommand(text.slice(1));
      const explicitId = first && /^\d{5,}|https?:/.test(first) ? first : null;
      const id = explicitId ?? selectedTweetId(state);
      const replyText = explicitId ? rest.join(" ") : [first, ...rest].filter(Boolean).join(" ");
      if (!id || !replyText) return usage(state, "Usage: /reply [tweet] <text>");
      return { type: "action", label: "Replying", args: ["reply", id, replyText], refresh: true };
    },
  },
  {
    name: "/quote",
    description: "Quote selected tweet or id",
    args: [{ name: "text", desc: "Quote text" }],
    handler: (text, state) => {
      const [, first, ...rest] = splitCommand(text.slice(1));
      const explicitId = first && /^\d{5,}|https?:/.test(first) ? first : null;
      const id = explicitId ?? selectedTweetId(state);
      const quoteText = explicitId ? rest.join(" ") : [first, ...rest].filter(Boolean).join(" ");
      if (!id || !quoteText) return usage(state, "Usage: /quote [tweet] <text>");
      return { type: "action", label: "Quote tweeting", args: ["post", "--quote", id, quoteText], refresh: true };
    },
  },
  ...(["like", "unlike", "rt", "unrt", "bookmark"] as const).map((name) => ({
    name: `/${name}`,
    description: `${name} selected tweet or id`,
    args: ID_ARGS,
    handler: (text: string, state: AppState): CommandResult => {
      const [, idArg] = splitCommand(text.slice(1));
      const id = idArg ?? selectedTweetId(state);
      if (!id) return usage(state, `Select a tweet or pass id: /${name} [tweet]`);
      return { type: "action", label: name, args: [name, id] };
    },
  } satisfies SlashCommand)),
  {
    name: "/delete",
    description: "Delete one of your tweets",
    args: ID_ARGS,
    handler: (text, state) => {
      const [, id] = splitCommand(text.slice(1));
      if (!id) return usage(state, "Usage: /delete <your tweet id>");
      return { type: "action", label: "Deleting", args: ["delete", id], refresh: true };
    },
  },
  {
    name: "/open",
    description: "Open selected URL or provided target",
    args: [{ name: "target", desc: "URL or path" }],
    handler: (text) => {
      const [, target] = splitCommand(text.slice(1));
      return { type: "open", target };
    },
  },
  {
    name: "/view",
    description: "Open a sidebar surface",
    args: VIEW_ARGS,
    handler: (text, state) => {
      const [, view] = splitCommand(text.slice(1));
      switch (view) {
        case "home": return { type: "load", args: ["timeline", "-n", "35"], title: "Home" };
        case "latest": return { type: "load", args: ["timeline", "--latest", "-n", "35"], title: "Latest" };
        case "notifs": return { type: "load", args: ["notifications", "-n", "35"], title: "Notifications" };
        case "bookmarks": return { type: "load", args: ["bookmarks", "-n", "35"], title: "Bookmarks" };
        case "trends": return { type: "load", args: ["trending", "-n", "35"], title: "Trending" };
        case "dms": return { type: "load", args: ["dms"], title: "DMs" };
        default: return usage(state, "Usage: /view [home|latest|notifs|bookmarks|trends|dms]");
      }
    },
  },
  {
    name: "/theme",
    description: "Set/show active theme",
    args: THEME_NAMES.map((name) => ({ name, desc: `${name} theme` })),
    handler: (text, state) => {
      const [, nameRaw] = splitCommand(text.slice(1));
      if (!nameRaw) {
        setNotice(state, `Theme: ${theme.name}`, "muted");
        clearPrompt(state);
        return { type: "handled" };
      }
      const name = nameRaw as ThemeName;
      if (!THEME_NAMES.includes(name)) return usage(state, `Unknown theme: ${nameRaw}. Available: ${THEME_NAMES.join(", ")}`);
      const err = setTheme(name);
      try { saveConfig({ theme: name }); } catch {}
      clearPrompt(state);
      setNotice(state, err ? `Theme changed but not persisted: ${err}` : `Theme: ${name}`, err ? "warning" : "success");
      return { type: "handled" };
    },
  },
];

export function tryCommand(text: string, state: AppState): CommandResult | null {
  if (!text.startsWith("/")) return null;
  const name = text.split(/\s+/)[0];
  const command = commands.find((candidate) => candidate.name === name);
  if (!command) return null;
  return command.handler(text, state);
}

export const COMMAND_LIST: CompletionItem[] = commands
  .filter((command) => command.name !== "/exit")
  .map((command) => ({ name: command.name, desc: command.description }));

export function getCommandArgs(state: AppState): Record<string, CompletionItem[]> {
  const registry: Record<string, CompletionItem[]> = {};
  for (const command of commands) {
    if (command.args && command.args.length > 0) registry[command.name] = command.args;
    if (command.getArgs) Object.assign(registry, command.getArgs(state));
  }
  return registry;
}
