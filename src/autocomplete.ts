/** Command and path autocomplete for the prompt line, ported from record. */

import { readdirSync } from "fs";
import { homedir } from "os";
import { basename, dirname, resolve } from "path";

import { COMMAND_LIST, getCommandArgs, type CompletionItem } from "./commands";
import type { AppState } from "./state";

export interface AutocompleteState {
  type: "command" | "path";
  selection: number;
  prefix: string;
  matches: CompletionItem[];
  tokenStart?: number;
}

function escapeRegex(text: string): string {
  return text.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function matchArgCompletion(raw: string, registry: Record<string, CompletionItem[]>): CompletionItem[] | null {
  const entries = Object.entries(registry).sort((a, b) => b[0].length - a[0].length);
  for (const [command, args] of entries) {
    const re = new RegExp(`^${escapeRegex(command)}\\s+(.*)$`, "i");
    const match = raw.match(re);
    if (match) return args.filter((arg) => arg.name.toLowerCase().startsWith(match[1].toLowerCase()));
  }
  return null;
}

function getCommandMatches(state: AppState, input: string): CompletionItem[] {
  const raw = input.trimStart();
  if (!raw.startsWith("/")) return [];

  const argMatch = matchArgCompletion(raw, getCommandArgs(state));
  if (argMatch) return argMatch;

  const prefix = raw.toLowerCase();
  return COMMAND_LIST.filter((command) => command.name.startsWith(prefix));
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n";
}

function tokenStart(input: string, pos: number): number {
  let start = pos;
  while (start > 0 && !isWhitespace(input[start - 1])) start--;
  return start;
}

export function updateAutocomplete(state: AppState): void {
  if (state.autocomplete?.type === "path") state.autocomplete = null;

  const trimmed = state.editor.buffer.trimStart();
  if (trimmed.startsWith("/") && !trimmed.includes("\n")) {
    const matches = getCommandMatches(state, state.editor.buffer);
    if (matches.length > 0) {
      state.autocomplete = {
        type: "command",
        selection: -1,
        prefix: state.editor.buffer,
        matches,
      };
      return;
    }
  }

  state.autocomplete = null;
}

function fillAutocomplete(state: AppState, name: string): void {
  const autocomplete = state.autocomplete;
  if (!autocomplete) return;

  if (autocomplete.type === "path" && autocomplete.tokenStart !== undefined) {
    const before = state.editor.buffer.slice(0, autocomplete.tokenStart);
    const after = state.editor.buffer.slice(state.editor.cursor);
    state.editor.buffer = before + name + after;
    state.editor.cursor = before.length + name.length;
    return;
  }

  if (!name.startsWith("/")) {
    const lastSpace = autocomplete.prefix.lastIndexOf(" ");
    if (lastSpace >= 0) state.editor.buffer = autocomplete.prefix.slice(0, lastSpace + 1) + name;
    else state.editor.buffer = name;
  } else {
    state.editor.buffer = name;
  }

  state.editor.cursor = state.editor.buffer.length;
}

export function cycleAutocomplete(state: AppState, direction: 1 | -1): void {
  const autocomplete = state.autocomplete;
  if (!autocomplete || autocomplete.matches.length === 0) return;

  if (direction === 1) autocomplete.selection = autocomplete.selection < 0 ? 0 : (autocomplete.selection + 1) % autocomplete.matches.length;
  else autocomplete.selection = autocomplete.selection <= 0 ? autocomplete.matches.length - 1 : (autocomplete.selection - 1);

  fillAutocomplete(state, autocomplete.matches[autocomplete.selection].name);
}

export function dismissAutocomplete(state: AppState): void {
  const autocomplete = state.autocomplete;
  if (!autocomplete) return;

  if (autocomplete.selection >= 0) {
    if (autocomplete.type === "path") {
      // Keep currently completed/common-prefix path text, matching record.
    } else {
      state.editor.buffer = autocomplete.prefix;
      state.editor.cursor = state.editor.buffer.length;
    }
  }

  state.autocomplete = null;
}

export function acceptAutocomplete(state: AppState): void {
  state.autocomplete = null;
}

export function tryPathComplete(state: AppState): boolean {
  const extracted = extractPathToken(state.editor.buffer, state.editor.cursor);
  if (!extracted) return false;

  const { token, start } = extracted;
  const matches = getFilesystemMatches(token);
  if (matches.length === 0) return false;

  const before = state.editor.buffer.slice(0, start);
  const after = state.editor.buffer.slice(state.editor.cursor);

  if (matches.length === 1) {
    state.editor.buffer = before + matches[0].name + after;
    state.editor.cursor = before.length + matches[0].name.length;
    state.autocomplete = null;
    return true;
  }

  state.editor.buffer = before + matches[0].name + after;
  state.editor.cursor = before.length + matches[0].name.length;
  state.autocomplete = { type: "path", selection: 0, prefix: before + token + after, tokenStart: start, matches };
  return true;
}

function extractPathToken(input: string, cursor: number): { token: string; start: number } | null {
  const start = tokenStart(input, cursor);
  const token = input.slice(start, cursor);
  if (token.length === 0) return null;
  if (token.startsWith("~/") || token.startsWith("./") || token.startsWith("../") || token === "~" || (token.startsWith("/") && token.length > 1)) {
    return { token, start };
  }
  return null;
}

function getFilesystemMatches(pathToken: string): CompletionItem[] {
  if (pathToken === "~") return [{ name: "~/", desc: "dir" }];

  const home = homedir();
  let expanded = pathToken;
  if (expanded === "~" || expanded.startsWith("~/")) expanded = home + expanded.slice(1);

  let dir: string;
  let prefix: string;
  if (expanded.endsWith("/")) {
    dir = resolve(expanded);
    prefix = "";
  } else {
    dir = dirname(resolve(expanded));
    prefix = basename(expanded);
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const filtered = entries
      .filter((entry) => entry.name.startsWith(prefix) && (prefix.startsWith(".") || !entry.name.startsWith(".")))
      .sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        if (aDir !== bDir) return aDir - bDir;
        return a.name.localeCompare(b.name);
      });

    const tokenDir = pathToken.endsWith("/") ? pathToken : pathToken.slice(0, pathToken.length - prefix.length);
    return filtered.map((entry) => ({ name: tokenDir + entry.name + (entry.isDirectory() ? "/" : ""), desc: entry.isDirectory() ? "dir" : "file" }));
  } catch {
    return [];
  }
}
