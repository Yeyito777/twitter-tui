/** Record-style login/logout helpers for Twitter credentials. */

import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { clearConfig, configDir, loadSavedLogins, saveConfig, saveSavedLogins, type SavedLogins, type TwitterCredentials } from "./config";
import type { Account } from "./types";

const TWITTER_CLI_ROOT = "/home/yeyito/Workspace/exocortex/external-tools/twitter-cli/src";
const TWITTER_CLI_CREDENTIALS_FILE = join(TWITTER_CLI_ROOT, "config", "credentials.json");

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

export function resolveLoginCredential(savedLogins: SavedLogins, credential: string): TwitterCredentials | null {
  return savedLogins[credential] ?? parseCredentialPair(credential);
}

export function writeTwitterCliCredentials(credentials: TwitterCredentials): void {
  mkdirSync(join(TWITTER_CLI_ROOT, "config"), { recursive: true, mode: 0o700 });
  writeFileSync(TWITTER_CLI_CREDENTIALS_FILE, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
}

export function removeTwitterCliCredentials(): void {
  rmSync(TWITTER_CLI_CREDENTIALS_FILE, { force: true });
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

export { TWITTER_CLI_CREDENTIALS_FILE };
