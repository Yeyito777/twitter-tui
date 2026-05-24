/** Config paths and user preferences for twitter-tui. */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
