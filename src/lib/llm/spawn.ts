// Child-process plumbing shared by the two CLI engines: binary discovery,
// one guarded `runProcess`, temp files, and a small concurrency gate so a
// nightly dream cycle can't fan out thirty CLI sessions at once against one
// subscription.

import { spawn } from "node:child_process";
import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RunOptions {
  bin: string;
  args: string[];
  stdin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Called with each complete stdout line as it arrives (streaming parsers). */
  onStdoutLine?: (line: string) => void;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export const DEFAULT_TIMEOUT_MS = Math.max(30_000, Number(process.env.LLM_TIMEOUT_MS) || 600_000);
const IS_WIN = process.platform === "win32";

/** cmd.exe needs explicit quoting because Node doesn't quote args under `shell: true`. */
function quoteForCmd(arg: string): string {
  if (arg === "") return '""';
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

export function runProcess(opts: RunOptions): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const args = IS_WIN ? opts.args.map(quoteForCmd) : opts.args;
    const child = spawn(IS_WIN ? quoteForCmd(opts.bin) : opts.bin, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: IS_WIN, // .cmd shims on Windows can only be started through the shell
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 5_000).unref();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!opts.onStdoutLine) return;
      lineBuffer += chunk;
      let nl = lineBuffer.indexOf("\n");
      while (nl !== -1) {
        const line = lineBuffer.slice(0, nl);
        lineBuffer = lineBuffer.slice(nl + 1);
        if (line.trim()) opts.onStdoutLine(line);
        nl = lineBuffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      settled = true;
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      settled = true;
      if (opts.onStdoutLine && lineBuffer.trim()) opts.onStdoutLine(lineBuffer);
      resolve({ stdout, stderr, code, signal, timedOut });
    });

    if (opts.stdin != null) {
      child.stdin.on("error", () => {
        /* EPIPE when the CLI exits early — the close handler reports it */
      });
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });
}

// ─── Binary discovery ────────────────────────────────────────────────────────

async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, IS_WIN ? fsConstants.F_OK : fsConstants.X_OK);
    const st = await fs.stat(file);
    return st.isFile();
  } catch {
    return false;
  }
}

/** Directories global CLIs commonly land in when the app's PATH is thin
 *  (an app launched from a GUI, a systemd unit, a different shell). */
function extraBinDirs(): string[] {
  const home = os.homedir();
  return [
    path.dirname(process.execPath), // the running node's bin dir (nvm/volta globals live here)
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".volta", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    path.join(home, ".claude", "bin"),
    path.join(home, ".codex", "bin"),
  ];
}

const binaryCache = new Map<string, string | null>();

/** Resolve a CLI: an explicit override path, else PATH, else the usual global dirs. */
export async function findBinary(name: string, override?: string): Promise<string | null> {
  const cacheKey = `${name}|${override ?? ""}`;
  if (binaryCache.has(cacheKey)) return binaryCache.get(cacheKey) ?? null;
  let found: string | null = null;
  if (override?.trim()) {
    found = (await isExecutable(override.trim())) ? override.trim() : null;
  } else {
    const dirs = [...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean), ...extraBinDirs()];
    const names = IS_WIN ? [`${name}.cmd`, `${name}.exe`, name] : [name];
    outer: for (const dir of dirs) {
      for (const n of names) {
        const candidate = path.join(dir, n);
        if (await isExecutable(candidate)) {
          found = candidate;
          break outer;
        }
      }
    }
  }
  binaryCache.set(cacheKey, found);
  return found;
}

export function forgetBinaries(): void {
  binaryCache.clear();
}

// ─── Scratch space ───────────────────────────────────────────────────────────

/** An empty working directory for CLI sessions: no CLAUDE.md, AGENTS.md or
 *  project config of ours can leak into a generation. Lives under data/ (gitignored). */
export async function llmWorkDir(): Promise<string> {
  const dir = path.join(process.cwd(), "data", "llm");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "prism-llm-"));
}

export async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

// ─── Concurrency gate ────────────────────────────────────────────────────────

const MAX_CONCURRENCY = Math.max(1, Number(process.env.LLM_MAX_CONCURRENCY) || 2);
let active = 0;
const waiting: (() => void)[] = [];

/** Run `fn` when a slot is free. Only the CLI engines use this: a subscription
 *  has a shared five-hour window, so bursts of parallel sessions help nobody. */
export async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export function concurrencyLimit(): number {
  return MAX_CONCURRENCY;
}
