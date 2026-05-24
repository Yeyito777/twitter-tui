/** Config paths for twitter-tui. */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";

export interface AppConfig {
  theme?: string;
  latest?: boolean;
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return `${xdg && xdg.length > 0 ? xdg : `${homedir()}/.config`}/twitter-tui`;
}

export function configPath(): string {
  return `${configDir()}/config.json`;
}

export function loadConfig(): AppConfig {
  return JSON.parse(readFileSync(configPath(), "utf8")) as AppConfig;
}

export function saveConfig(config: AppConfig): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
