/** Record-style login/logout helpers for Twitter credentials. */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { clearConfig, loadConfig, loadSavedLogins, saveConfig, saveSavedLogins, type SavedLogins, type TwitterCredentials } from "./config";
import type { Account } from "./types";

const DEFAULT_TWITTER_CLI_ROOT = "/home/yeyito/Workspace/exocortex/external-tools/twitter-cli";

function twitterCliRoot(): string {
  return process.env.TWITTER_TUI_TWITTER_CLI_ROOT?.trim() || DEFAULT_TWITTER_CLI_ROOT;
}

export function twitterCliCredentialsFile(): string {
  return join(twitterCliRoot(), "config", "credentials.json");
}

function legacyWrongCredentialsFile(): string {
  return join(twitterCliRoot(), "src", "config", "credentials.json");
}

export function normalizeCredential(value: string): string {
  return value.replace(/\r\n/g, " ").replace(/[\r\n\t]+/g, " ").trim().replace(/\s+/g, " ");
}

export function parseCredentialPair(credential: string): TwitterCredentials | null {
  const normalized = normalizeCredential(credential);
  if (!normalized) return null;

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const auth_token = typeof record.auth_token === "string" ? record.auth_token.trim() : "";
      const ct0 = typeof record.ct0 === "string" ? record.ct0.trim() : "";
      if (auth_token && ct0) return { auth_token, ct0 };
    }
  } catch {}

  const cookieAuth = normalized.match(/(?:^|[;\s])auth_token=([^;\s]+)/)?.[1];
  const cookieCt0 = normalized.match(/(?:^|[;\s])ct0=([^;\s]+)/)?.[1];
  if (cookieAuth && cookieCt0) return { auth_token: cookieAuth, ct0: cookieCt0 };

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { auth_token: parts[0], ct0: parts[1] };
  return null;
}

export function loadSavedLoginsSafe(): SavedLogins {
  try { return loadSavedLogins(); } catch { return {}; }
}

export function loadConfiguredCredentials(): TwitterCredentials | null {
  try {
    const config = loadConfig();
    const auth_token = typeof config.auth_token === "string" ? config.auth_token.trim() : "";
    const ct0 = typeof config.ct0 === "string" ? config.ct0.trim() : "";
    return auth_token && ct0 ? { auth_token, ct0 } : null;
  } catch {
    return null;
  }
}

export function resolveLoginCredential(savedLogins: SavedLogins, credential: string): TwitterCredentials | null {
  return savedLogins[credential] ?? parseCredentialPair(credential);
}

export function writeTwitterCliCredentials(credentials: TwitterCredentials): void {
  const credentialsFile = twitterCliCredentialsFile();
  mkdirSync(join(twitterCliRoot(), "config"), { recursive: true, mode: 0o700 });
  writeFileSync(credentialsFile, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  // 2026-05-25 bugfix: older twitter-tui builds accidentally wrote here. The
  // real twitter CLI reads <root>/config/credentials.json, so remove the stale
  // shadow file after a successful write to avoid future confusion.
  rmSync(legacyWrongCredentialsFile(), { force: true });
}

export function removeTwitterCliCredentials(): void {
  rmSync(twitterCliCredentialsFile(), { force: true });
  rmSync(legacyWrongCredentialsFile(), { force: true });
}

export function snapshotTwitterCliCredentials(): string | null {
  const credentialsFile = twitterCliCredentialsFile();
  return existsSync(credentialsFile) ? readFileSync(credentialsFile, "utf8") : null;
}

export function restoreTwitterCliCredentials(snapshot: string | null): void {
  const credentialsFile = twitterCliCredentialsFile();
  if (snapshot === null) {
    rmSync(credentialsFile, { force: true });
    return;
  }
  mkdirSync(join(twitterCliRoot(), "config"), { recursive: true, mode: 0o700 });
  writeFileSync(credentialsFile, snapshot, { mode: 0o600 });
}

function nextSavedLogins(savedLogins: SavedLogins, account: Account, credentials: TwitterCredentials): SavedLogins {
  const key = account.handle || account.id || "twitter";
  const entries = Object.entries(savedLogins).filter(([, saved]) => saved.auth_token !== credentials.auth_token || saved.ct0 !== credentials.ct0);
  return { ...Object.fromEntries(entries), [key]: credentials };
}

export function saveValidatedLogin(savedLogins: SavedLogins, account: Account, credentials: TwitterCredentials): SavedLogins {
  saveConfig({ auth_token: credentials.auth_token, ct0: credentials.ct0 });
  writeTwitterCliCredentials(credentials);
  const next = nextSavedLogins(savedLogins, account, credentials);
  saveSavedLogins(next);
  return next;
}

export function logoutCredentials(): void {
  clearConfig();
  removeTwitterCliCredentials();
}

export { DEFAULT_TWITTER_CLI_ROOT };
