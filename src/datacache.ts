/**
 * Record-style stale-while-revalidate cache for Twitter surfaces and threads.
 *
 * The cache is account-scoped, debounced, atomically persisted, and compacted on
 * disk. Sidebar surfaces hydrate instantly when available; network loads then
 * revalidate in the background. The last 100 opened tweet threads are kept.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname, join } from "path";

import { configDir } from "./config";
import type { FeedResult, TimelineItem } from "./types";

export interface CachedFeed {
  savedAt: number;
  args: string[];
  feed: FeedResult;
}

interface AccountDataCache {
  savedAt: number;
  surfaces: Record<string, CachedFeed>;
  threads: Record<string, CachedFeed>;
  threadOrder: string[];
}

interface TwitterCacheFile {
  version: 1;
  accounts: Record<string, AccountDataCache>;
}

const CACHE_VERSION = 1;
const CACHE_SAVE_DEBOUNCE_MS = 2_500;
const MAX_THREAD_CACHE_ENTRIES = 100;
const MAX_ITEMS_PER_FEED = 160;

let cacheMemo: TwitterCacheFile | null = null;
let cacheMemoPath: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInFlight = false;
let saveAgain = false;
let cacheDirty = false;
let beforeExitFlushRegistered = false;

function cachePath(): string {
  return join(configDir(), "cache.json");
}

function emptyCache(): TwitterCacheFile {
  return { version: CACHE_VERSION, accounts: {} };
}

function safeAccountId(accountId: string): string {
  return accountId || "default";
}

function loadCacheFile(): TwitterCacheFile {
  const path = cachePath();
  if (cacheMemo && cacheMemoPath === path) return cacheMemo;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TwitterCacheFile>;
    if (parsed.version !== CACHE_VERSION || typeof parsed.accounts !== "object" || parsed.accounts === null) {
      cacheMemo = emptyCache();
    } else {
      cacheMemo = { version: CACHE_VERSION, accounts: parsed.accounts as Record<string, AccountDataCache> };
    }
  } catch {
    cacheMemo = emptyCache();
  }
  cacheMemoPath = path;
  return cacheMemo;
}

function accountCache(cache: TwitterCacheFile, accountId: string): AccountDataCache {
  const id = safeAccountId(accountId);
  cache.accounts[id] ??= { savedAt: Date.now(), surfaces: {}, threads: {}, threadOrder: [] };
  cache.accounts[id].surfaces ??= {};
  cache.accounts[id].threads ??= {};
  cache.accounts[id].threadOrder ??= [];
  return cache.accounts[id];
}

function saveCacheFile(cache: TwitterCacheFile): void {
  cacheMemo = cache;
  cacheMemoPath = cachePath();
  cacheDirty = true;
  registerBeforeExitFlush();
  scheduleCacheWrite();
}

function registerBeforeExitFlush(): void {
  if (beforeExitFlushRegistered) return;
  beforeExitFlushRegistered = true;
  process.once("beforeExit", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void flushTwitterCacheFile();
  });
  process.once("exit", () => {
    flushTwitterCacheSync();
  });
}

function scheduleCacheWrite(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushTwitterCacheFile();
  }, CACHE_SAVE_DEBOUNCE_MS);
  saveTimer.unref?.();
}

async function flushTwitterCacheFile(): Promise<void> {
  if (saveInFlight) {
    saveAgain = true;
    return;
  }
  if (!cacheMemo || !cacheDirty) return;
  const cache = cacheMemo;
  const path = cacheMemoPath ?? cachePath();
  cacheDirty = false;
  saveInFlight = true;
  try {
    await writeJsonFileAtomic(path, `${JSON.stringify(compactCacheForDisk(cache))}\n`);
  } catch {
    cacheDirty = true;
  } finally {
    saveInFlight = false;
    if (saveAgain || cacheDirty) {
      saveAgain = false;
      scheduleCacheWrite();
    }
  }
}

export function flushTwitterCacheSync(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!cacheMemo || !cacheDirty) return;
  const path = cacheMemoPath ?? cachePath();
  try {
    writeJsonFileAtomicSync(path, `${JSON.stringify(compactCacheForDisk(cacheMemo))}\n`);
    cacheDirty = false;
    saveAgain = false;
  } catch {
    cacheDirty = true;
  }
}

async function writeJsonFileAtomic(path: string, contents: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, contents, { mode: 0o600 });
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function writeJsonFileAtomicSync(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, contents, { mode: 0o600 });
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function compactCacheForDisk(cache: TwitterCacheFile): TwitterCacheFile {
  return {
    version: CACHE_VERSION,
    accounts: Object.fromEntries(Object.entries(cache.accounts).map(([accountId, account]) => [
      accountId,
      compactAccountCache(account),
    ])),
  };
}

function compactAccountCache(account: AccountDataCache): AccountDataCache {
  const threadOrder = uniqueStrings(account.threadOrder)
    .filter((threadId) => account.threads[threadId])
    .slice(0, MAX_THREAD_CACHE_ENTRIES);
  const threads = Object.fromEntries(threadOrder.map((threadId) => [threadId, compactCachedFeed(account.threads[threadId])]));
  const surfaces = Object.fromEntries(Object.entries(account.surfaces).map(([key, entry]) => [key, compactCachedFeed(entry)]));
  return { savedAt: account.savedAt, surfaces, threads, threadOrder };
}

function compactCachedFeed(entry: CachedFeed): CachedFeed {
  return {
    ...entry,
    args: [...entry.args],
    feed: {
      ...entry.feed,
      items: entry.feed.items.slice(0, MAX_ITEMS_PER_FEED),
      cursors: { ...entry.feed.cursors },
    },
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function sidebarSurfaceKeyFromArgs(args: readonly string[]): string | null {
  switch (args[0]) {
    case "timeline": return args.includes("--latest") ? "latest" : "home";
    case "notifications": return "notifications";
    case "bookmarks": return "bookmarks";
    case "trending": return "trending";
    case "dms": return "dms";
    default: return null;
  }
}

export function threadIdFromArgs(args: readonly string[]): string | null {
  return args[0] === "thread" && args[1] ? args[1] : null;
}

export function loadCachedSurface(accountId: string, surfaceKey: string): CachedFeed | null {
  return cloneCachedFeed(loadCacheFile().accounts[safeAccountId(accountId)]?.surfaces?.[surfaceKey]) ?? null;
}

export function saveCachedSurface(accountId: string, surfaceKey: string, entry: CachedFeed): void {
  const cache = loadCacheFile();
  const account = accountCache(cache, accountId);
  account.surfaces[surfaceKey] = compactCachedFeed(entry);
  account.savedAt = Date.now();
  saveCacheFile(cache);
}

export function loadCachedThread(accountId: string, tweetId: string): CachedFeed | null {
  return cloneCachedFeed(loadCacheFile().accounts[safeAccountId(accountId)]?.threads?.[tweetId]) ?? null;
}

export function saveCachedThread(accountId: string, tweetId: string, entry: CachedFeed): void {
  const cache = loadCacheFile();
  const account = accountCache(cache, accountId);
  account.threads[tweetId] = compactCachedFeed(entry);
  account.threadOrder = [tweetId, ...account.threadOrder.filter((id) => id !== tweetId)].slice(0, MAX_THREAD_CACHE_ENTRIES);
  for (const oldId of Object.keys(account.threads)) {
    if (!account.threadOrder.includes(oldId)) delete account.threads[oldId];
  }
  account.savedAt = Date.now();
  saveCacheFile(cache);
}

export function cachedFeedForArgs(accountId: string, args: readonly string[]): CachedFeed | null {
  const surfaceKey = sidebarSurfaceKeyFromArgs(args);
  if (surfaceKey) return loadCachedSurface(accountId, surfaceKey);
  const threadId = threadIdFromArgs(args);
  if (threadId) return loadCachedThread(accountId, threadId);
  return null;
}

export function cachedFeedForArgsAnyAccount(args: readonly string[]): CachedFeed | null {
  const cache = loadCacheFile();
  let best: CachedFeed | null = null;
  for (const account of Object.values(cache.accounts)) {
    const surfaceKey = sidebarSurfaceKeyFromArgs(args);
    const threadId = threadIdFromArgs(args);
    const candidate = surfaceKey
      ? cloneCachedFeed(account.surfaces?.[surfaceKey])
      : threadId
        ? cloneCachedFeed(account.threads?.[threadId])
        : null;
    if (!candidate) continue;
    if (!best || candidate.savedAt > best.savedAt) best = candidate;
  }
  return best;
}

export function saveFeedForArgs(accountId: string, args: readonly string[], feed: FeedResult): void {
  const entry: CachedFeed = { savedAt: Date.now(), args: [...args], feed: cloneFeed(feed) };
  const surfaceKey = sidebarSurfaceKeyFromArgs(args);
  if (surfaceKey) {
    saveCachedSurface(accountId, surfaceKey, entry);
    return;
  }
  const threadId = threadIdFromArgs(args);
  if (threadId) saveCachedThread(accountId, threadId, entry);
}

function cloneCachedFeed(entry: CachedFeed | undefined): CachedFeed | null {
  if (!entry) return null;
  return { savedAt: entry.savedAt, args: [...entry.args], feed: cloneFeed(entry.feed) };
}

function cloneFeed(feed: FeedResult): FeedResult {
  return {
    ...feed,
    items: feed.items.map(cloneItem),
    cursors: { ...feed.cursors },
    profile: feed.profile ? { ...feed.profile } : undefined,
  };
}

function cloneItem<T extends TimelineItem>(item: T): T {
  return JSON.parse(JSON.stringify(item)) as T;
}
