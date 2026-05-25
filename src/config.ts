/** Config paths and user preferences for twitter-tui. */
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";

export interface OpenCommandConfig {
  /** Executable to spawn when opening a matching target. */
  command: string;
  /** Arguments passed to command. Supports {target}, {path}, {target:sh}, and {path:sh}. */
  args?: string[];
}

export interface OpenFileRuleConfig extends OpenCommandConfig {
  /** File extensions handled by this opener, without a leading dot. */
  extensions: string[];
}

export interface OpenersConfig {
  /** Opener used for http/https links. Set to null to disable link opening. */
  url?: OpenCommandConfig | null;
  /** File openers matched by extension, checked in order. */
  rules?: OpenFileRuleConfig[];
}

export interface AppConfig {
  auth_token?: string;
  ct0?: string;
  theme?: string;
  latest?: boolean;
  /** Open-on-enter commands for links/media/path targets. */
  openers?: OpenersConfig;
  /** Preserve unknown future/user keys. */
  [key: string]: unknown;
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return `${xdg && xdg.length > 0 ? xdg : `${homedir()}/.config`}/twitter-tui`;
}

export function configPath(): string {
  return `${configDir()}/config.json`;
}

export function savedLoginsPath(): string {
  return `${configDir()}/saved-logins.json`;
}

export interface TwitterCredentials {
  auth_token: string;
  ct0: string;
}

export type SavedLogins = Record<string, TwitterCredentials>;

export function defaultOpenersConfig(): OpenersConfig {
  return {
    url: { command: "xdg-open", args: ["{target}"] },
    rules: [
      { extensions: ["gif"], command: "video-play", args: ["{path}"] },
      {
        extensions: [
          "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff",
          "avif", "heic", "heif", "svg", "ico", "jxl", "jp2", "ppm", "pgm",
          "pbm", "pnm", "pdf",
        ],
        command: "show",
        args: ["{path}"],
      },
      { extensions: ["html"], command: "xdg-open", args: ["{path}"] },
      {
        extensions: [
          "mp3", "wav", "flac", "m4a", "aac", "ogg", "oga", "opus", "wma",
          "aif", "aiff", "alac", "mid", "midi", "mov", "mp4", "m4v", "mkv",
          "webm", "avi",
        ],
        command: "st",
        args: ["-e", "zsh", "-ic", "exec audio-play {path:sh}"],
      },
      { extensions: ["md", "py", "txt"], command: "st", args: ["-e", "zsh", "-ic", "exec nvim {path:sh}"] },
    ],
  };
}

export function loadConfig(): AppConfig {
  return JSON.parse(readFileSync(configPath(), "utf8")) as AppConfig;
}

export function loadSavedLogins(): SavedLogins {
  const parsed = JSON.parse(readFileSync(savedLoginsPath(), "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Saved logins file must contain a JSON object.");
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, TwitterCredentials] => {
    const value = entry[1];
    return typeof entry[0] === "string" && typeof value === "object" && value !== null && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).auth_token === "string"
      && typeof (value as Record<string, unknown>).ct0 === "string";
  }).map(([name, value]) => [name, { auth_token: value.auth_token.trim(), ct0: value.ct0.trim() }]));
}

function loadConfigIfPresent(): AppConfig {
  try {
    return loadConfig();
  } catch {
    return {};
  }
}

function writeSecureJson(path: string, value: unknown): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(configDir(), 0o700);
    chmodSync(path, 0o600);
  } catch {
    // Best effort only.
  }
}

export function saveConfig(config: AppConfig): void {
  const existing = loadConfigIfPresent();
  writeSecureJson(configPath(), {
    ...existing,
    ...config,
    ...(existing.openers || config.openers ? { openers: { ...existing.openers, ...config.openers } } : {}),
  });
}

export function saveSavedLogins(savedLogins: SavedLogins): void {
  const sortedEntries = Object.entries(savedLogins).sort((a, b) => a[0].localeCompare(b[0]));
  writeSecureJson(savedLoginsPath(), Object.fromEntries(sortedEntries));
}

export function clearConfig(): void {
  const config = loadConfigIfPresent();
  delete config.auth_token;
  delete config.ct0;
  if (Object.keys(config).length > 0) writeSecureJson(configPath(), config);
  else rmSync(configPath(), { force: true });
}
