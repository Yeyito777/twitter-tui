/** Theme system copied from record, with twitter-tui config/env names. */
import { mkdirSync, readFileSync, writeFileSync } from "fs";

import { configDir } from "./config";
import { cerberus } from "./themes/cerberus";
import { whale } from "./themes/whale";

export interface Theme {
  name: string;
  reset: string;
  bold: string;
  dim: string;
  italic: string;
  accent: string;
  text: string;
  muted: string;
  error: string;
  failure: string;
  warning: string;
  success: string;
  prompt: string;
  tool: string;
  command: string;
  vimNormal: string;
  vimInsert: string;
  vimVisual: string;
  topbarBg: string;
  userBg: string;
  sidebarBg: string;
  sidebarSelBg: string;
  cursorBg: string;
  historyLineBg: string;
  messageDeleteFg: string;
  selectionBg: string;
  searchBg: string;
  searchFg: string;
  notificationBg: string;
  notificationFg: string;
  pingBg: string;
  appBg?: string;
  cursorColor?: string;
  borderFocused: string;
  borderUnfocused: string;
  boldOff: string;
  italicOff: string;
}

export const themes = { whale, cerberus } satisfies Record<string, Theme>;
export type ThemeName = keyof typeof themes;
export const THEME_NAMES = Object.keys(themes) as ThemeName[];

function themeConfigPath(): string {
  return `${configDir()}/theme.json`;
}

function loadPersistedThemeName(): ThemeName | null {
  try {
    const data = JSON.parse(readFileSync(themeConfigPath(), "utf8")) as { theme?: string };
    if (data.theme && data.theme in themes) return data.theme as ThemeName;
  } catch {}
  return null;
}

function persistThemeName(name: ThemeName): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(themeConfigPath(), `${JSON.stringify({ theme: name }, null, 2)}\n`, { mode: 0o600 });
}

export const theme: Theme = { ...whale };

const envTheme = process.env.TWITTER_TUI_THEME ?? process.env.RECORD_THEME;
if (envTheme && envTheme in themes) {
  Object.assign(theme, themes[envTheme as ThemeName]);
} else {
  const persisted = loadPersistedThemeName();
  if (persisted) Object.assign(theme, themes[persisted]);
}

export type NoticeTone = "muted" | "success" | "warning" | "error";

export function toneColor(tone: NoticeTone): string {
  switch (tone) {
    case "success": return theme.success;
    case "warning": return theme.warning;
    case "error": return theme.error;
    case "muted":
    default: return theme.muted;
  }
}

const AUTHOR_COLORS = [
  [255, 184, 108], [189, 147, 249], [80, 250, 123], [255, 121, 198],
  [139, 233, 253], [241, 250, 140], [166, 227, 161], [250, 179, 135],
] as const;

export function authorColor(id: string): string {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const [r, g, b] = AUTHOR_COLORS[hash % AUTHOR_COLORS.length];
  return `\x1b[38;2;${r};${g};${b}m`;
}

export function setTheme(name: ThemeName): string | null {
  Object.assign(theme, themes[name]);
  try {
    persistThemeName(name);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
