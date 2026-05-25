import { join } from "path";
import type { Account, BackendResult, FeedResult } from "./types";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const BRIDGE = join(ROOT, "scripts", "twitter-json.py");

async function runProcess(args: string[], options: { timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const timeoutMs = options.timeoutMs ?? 45000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code: timedOut ? 124 : code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

function conciseError(stderr: string, stdout = ""): string {
  const lines = `${stderr}\n${stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningful = [...lines].reverse().find((line) => !line.startsWith("File ") && !line.startsWith("Traceback"));
  return meaningful ?? lines.at(-1) ?? "command failed";
}

export async function loadFeed(args: string[]): Promise<FeedResult> {
  const result = await runProcess(["python3", BRIDGE, ...args], { timeoutMs: 90000 });
  const text = result.stdout.trim();
  let parsed: BackendResult | null = null;
  if (text) {
    const lastLine = text.split("\n").at(-1) ?? text;
    try {
      parsed = JSON.parse(lastLine) as BackendResult;
    } catch (error) {
      throw new Error(`backend returned non-JSON output: ${(error as Error).message}\n${text.slice(0, 500)}`);
    }
  }
  if (!parsed) {
    throw new Error(result.stderr.trim() ? conciseError(result.stderr, result.stdout) : `twitter backend exited ${result.code} with no output`);
  }
  if (!parsed.ok) {
    throw new Error(parsed.error || result.stderr.trim() || "twitter backend failed");
  }
  if ("account" in parsed) {
    throw new Error("twitter backend returned account where feed was expected");
  }
  return parsed;
}

export async function loadAccount(): Promise<Account> {
  const result = await runProcess(["python3", BRIDGE, "account"], { timeoutMs: 45000 });
  const text = result.stdout.trim();
  let parsed: BackendResult | null = null;
  if (text) {
    const lastLine = text.split("\n").at(-1) ?? text;
    parsed = JSON.parse(lastLine) as BackendResult;
  }
  if (!parsed) throw new Error(result.stderr.trim() ? conciseError(result.stderr, result.stdout) : "account backend returned no output");
  if (!parsed.ok) throw new Error(parsed.error || result.stderr.trim() || "account backend failed");
  if (!("account" in parsed)) throw new Error("account backend returned non-account payload");
  return parsed.account;
}

export async function twitterCli(args: string[], timeoutMs = 60000): Promise<string> {
  const result = await runProcess(["twitter", ...args], { timeoutMs });
  const out = result.stdout.trim();
  const err = result.stderr.trim();
  if (result.code !== 0) {
    throw new Error(err || out ? conciseError(err, out) : `twitter ${args[0] ?? ""} exited ${result.code}`);
  }
  return out || err || "ok";
}

export function feedArgsForView(viewId: string): string[] {
  switch (viewId) {
    case "home": return ["timeline", "-n", "35"];
    case "notifications": return ["notifications", "-n", "35"];
    case "bookmarks": return ["bookmarks", "-n", "35"];
    case "dms": return ["dms"];
    default: return ["timeline", "-n", "35"];
  }
}
