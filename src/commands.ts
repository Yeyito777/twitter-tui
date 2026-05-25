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
  | { type: "login"; credential: string }
  | { type: "logout" }
  | { type: "theme_changed" };

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

const commands: SlashCommand[] = [
  { name: "/quit", description: "Exit twitter-tui", handler: () => ({ type: "quit" }) },
  {
    name: "/login",
    description: "Run Twitter login flow, or save pasted auth_token and ct0",
    args: [
      { name: "auth_token", desc: "browser auth_token cookie" },
      { name: "ct0", desc: "browser ct0 cookie" },
    ],
    getArgs: (state) => ({
      "/login": Object.keys(state.savedLogins).sort((a, b) => a.localeCompare(b)).map((name) => ({ name, desc: "saved login" })),
    }),
    handler: (text, state) => {
      const parts = splitCommand(text);
      if (parts.length === 1) return usage(state, "Usage: /login <saved-login|auth_token ct0|cookie-string|json>");
      const credential = text.slice(parts[0].length).trim();
      if (!credential) return usage(state, "Usage: /login <saved-login|auth_token ct0|cookie-string|json>");
      return { type: "login", credential };
    },
  },
  {
    name: "/logout",
    description: "Remove stored Twitter credentials",
    handler: (text, state) => {
      const parts = splitCommand(text);
      if (parts.length !== 1) return usage(state, "Usage: /logout");
      return { type: "logout" };
    },
  },
  {
    name: "/theme",
    description: "Set/show active theme",
    args: THEME_NAMES.map((name) => ({ name, desc: `${name} theme` })),
    handler: (text, state) => {
      const [, nameRaw] = splitCommand(text);
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
      return { type: "theme_changed" };
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

export const COMMAND_LIST: CompletionItem[] = commands.map((command) => ({ name: command.name, desc: command.description }));

export function getCommandArgs(state: AppState): Record<string, CompletionItem[]> {
  const registry: Record<string, CompletionItem[]> = {};
  for (const command of commands) {
    if (command.args && command.args.length > 0) registry[command.name] = command.args;
    if (command.getArgs) Object.assign(registry, command.getArgs(state));
  }
  return registry;
}
