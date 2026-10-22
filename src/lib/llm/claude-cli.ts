// Engine: Claude Code (`claude -p`) — bills the user's own Claude subscription.
//
// The policy line we stay on (Anthropic, "Authentication and credential use"):
// the end user signs in to the UNMODIFIED Claude Code binary themselves; Prism
// only spawns it. We never read ~/.claude, never set CLAUDE_CODE_OAUTH_TOKEN,
// and never pass --bare (bare mode skips the subscription login by design).
// `--safe-mode` keeps authentication and model selection but loads none of the
// user's CLAUDE.md, hooks, MCP servers, plugins or skills, so a generation is
// just our system prompt + our task.

import { promises as fs } from "node:fs";
import path from "node:path";
import { UsageLimitError, USAGE_LIMIT_RE, usageLimitMessage } from "./errors";
import { findBinary, llmWorkDir, makeTempDir, removeDir, runProcess } from "./spawn";
import { parseJsonLoose, renderTranscript } from "./transcript";
import type { EngineStatus, LlmRequest, LlmResult, ModelTier } from "./types";
import { ENGINE_LABELS } from "./types";

const HOW_TO = [
  "Install Claude Code: npm install -g @anthropic-ai/claude-code",
  "Sign in with your Claude Pro/Max account: claude auth login",
  "Keep the app and the worker running in a shell where `claude` is on PATH (or set CLAUDE_BIN).",
];

const MODEL_ALIAS: Record<ModelTier, string> = { opus: "opus", sonnet: "sonnet", haiku: "haiku" };

function modelFor(req: LlmRequest): string {
  if (req.model) return req.model;
  const tier = req.tier ?? "opus";
  const override = process.env[`CLAUDE_CLI_MODEL_${tier.toUpperCase()}`];
  return override?.trim() || MODEL_ALIAS[tier];
}

/** The child's environment: the user's shell env minus any API key, so a forced
 *  claude-cli run can never silently bill the API instead of the subscription. */
function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export interface ClaudeRateLimit {
  status?: string;
  rateLimitType?: string;
  resetsAt?: number; // epoch seconds
  fiveHourUtilization?: number;
  sevenDayUtilization?: number;
  seenAt: string;
}

let lastRateLimit: ClaudeRateLimit | null = null;

/** The most recent plan-window reading Claude Code reported (shown on Connections). */
export function lastClaudeRateLimit(): ClaudeRateLimit | null {
  return lastRateLimit;
}

function recordRateLimit(info: Record<string, unknown> | undefined): void {
  if (!info) return;
  const windows = (info.unifiedWindows ?? {}) as Record<string, { utilization?: number; resetsAt?: number }>;
  lastRateLimit = {
    status: typeof info.status === "string" ? info.status : undefined,
    rateLimitType: typeof info.rateLimitType === "string" ? info.rateLimitType : undefined,
    resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : undefined,
    fiveHourUtilization: windows.five_hour?.utilization,
    sevenDayUtilization: windows.seven_day?.utilization,
    seenAt: new Date().toISOString(),
  };
}

export async function claudeStatus(): Promise<EngineStatus> {
  const base: EngineStatus = {
    engine: "claude-cli",
    label: ENGINE_LABELS["claude-cli"],
    installed: false,
    ready: false,
    detail: "Not installed.",
    webSearch: true,
    howTo: HOW_TO,
  };
  const bin = await findBinary("claude", process.env.CLAUDE_BIN);
  if (!bin) return base;
  base.installed = true;
  try {
    const [ver, auth] = await Promise.all([
      runProcess({ bin, args: ["--version"], timeoutMs: 20_000, env: cliEnv() }),
      runProcess({ bin, args: ["auth", "status"], timeoutMs: 30_000, env: cliEnv() }),
    ]);
    base.version = ver.stdout.trim().split(/\s+/)[0] || undefined;
    let info: { loggedIn?: boolean; authMethod?: string; subscriptionType?: string } = {};
    try {
      info = JSON.parse(auth.stdout.trim().replace(/^[^{]*/, "")) as typeof info;
    } catch {
      /* older CLI or plain-text output: fall through to the exit code */
    }
    const loggedIn = info.loggedIn ?? auth.code === 0;
    base.authMethod = info.authMethod;
    base.plan = info.subscriptionType;
    base.model = modelFor({ system: "", messages: [] });
    if (loggedIn) {
      base.ready = true;
      base.detail = `Signed in${info.authMethod ? ` with ${info.authMethod}` : ""}${info.subscriptionType ? ` (${info.subscriptionType} plan)` : ""}.`;
      if (info.authMethod === "api_key" || info.authMethod === "api_key_helper") {
        base.detail += " Note: this sign-in bills the API, not a subscription.";
      }
    } else {
      base.detail = "Installed but not signed in — run `claude auth login`.";
    }
  } catch (err) {
    base.detail = `Installed, but it failed to answer: ${err instanceof Error ? err.message : String(err)}`;
  }
  return base;
}

export interface ClaudeResultLine {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
  total_cost_usd?: number;
  modelUsage?: Record<string, unknown>;
}

export interface ClaudeStreamState {
  /** Text accumulated from stream-json deltas. */
  acc: string;
  result: ClaudeResultLine | null;
}

/** One line of `--output-format json|stream-json` stdout. Pure apart from the
 *  rate-limit bookkeeping, so the parser is unit-testable against fixtures. */
export function handleClaudeLine(line: string, state: ClaudeStreamState, onDelta?: (acc: string) => void): void {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  if (obj.type === "rate_limit_event") {
    recordRateLimit(obj.rate_limit_info as Record<string, unknown> | undefined);
  } else if (obj.type === "stream_event") {
    const event = obj.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
    if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
      state.acc += event.delta.text;
      onDelta?.(state.acc);
    }
  } else if (obj.type === "result") {
    state.result = obj as unknown as ClaudeResultLine;
  }
}

/** Non-streaming mode prints one JSON object (not always newline-terminated). */
export function parseClaudeStdout(stdout: string): ClaudeResultLine | null {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed) as ClaudeResultLine;
    if (parsed?.type === "result") return parsed;
  } catch {
    /* maybe several lines */
  }
  const state: ClaudeStreamState = { acc: "", result: null };
  for (const line of trimmed.split("\n")) handleClaudeLine(line, state);
  return state.result;
}

function resetDate(): Date | undefined {
  return lastRateLimit?.resetsAt ? new Date(lastRateLimit.resetsAt * 1000) : undefined;
}

export async function claudeGenerate(req: LlmRequest, attempt = 0): Promise<LlmResult> {
  const bin = await findBinary("claude", process.env.CLAUDE_BIN);
  if (!bin) throw new Error("Claude Code is not installed (npm install -g @anthropic-ai/claude-code).");

  const streaming = Boolean(req.onDelta) && !req.schema;
  const web = req.tools === "web";
  const model = modelFor(req);
  const tmp = await makeTempDir();
  const systemPath = path.join(tmp, "system.md");
  await fs.writeFile(systemPath, req.system, "utf8");

  const args = [
    "-p",
    "--safe-mode",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--tools",
    web ? "WebSearch,WebFetch" : "",
    "--model",
    model,
    "--system-prompt-file",
    systemPath,
    "--output-format",
    streaming ? "stream-json" : "json",
    ...(streaming ? ["--verbose", "--include-partial-messages"] : []),
    ...(req.schema ? ["--json-schema", JSON.stringify(req.schema)] : []),
    ...(web ? ["--max-turns", "12"] : []),
  ];

  const state: ClaudeStreamState = { acc: "", result: null };
  let run;
  try {
    run = await runProcess({
      bin,
      args,
      stdin: renderTranscript(req.messages),
      cwd: await llmWorkDir(),
      env: cliEnv(),
      timeoutMs: req.timeoutMs,
      onStdoutLine: streaming ? (line) => handleClaudeLine(line, state, req.onDelta) : undefined,
    });
  } finally {
    await removeDir(tmp);
  }

  if (run.timedOut) {
    throw new Error(`Claude Code timed out after ${Math.round((req.timeoutMs ?? 600_000) / 1000)}s${req.label ? ` (${req.label})` : ""}.`);
  }
  const final = state.result ?? parseClaudeStdout(run.stdout);
  const acc = state.acc;
  if (!final) {
    const tail = (run.stderr || run.stdout).trim().slice(-800);
    if (USAGE_LIMIT_RE.test(tail)) throw new UsageLimitError("claude-cli", usageLimitMessage("claude-cli", resetDate()), resetDate());
    throw new Error(`Claude Code exited with code ${run.code ?? "?"}${tail ? `: ${tail}` : ""}`);
  }
  if (final.is_error || (final.subtype && final.subtype !== "success")) {
    const msg = (final.result || final.subtype || "unknown error").toString();
    if (USAGE_LIMIT_RE.test(msg) || lastRateLimit?.status === "rejected") {
      throw new UsageLimitError("claude-cli", usageLimitMessage("claude-cli", resetDate()), resetDate());
    }
    throw new Error(`Claude Code: ${msg.slice(0, 600)}`);
  }

  const text = (final.result ?? acc ?? "").toString();
  let json: unknown = final.structured_output;
  if (req.schema && json === undefined) {
    try {
      json = parseJsonLoose(text);
    } catch {
      if (attempt === 0) {
        const retry: LlmRequest = {
          ...req,
          messages: [
            ...req.messages,
            { role: "assistant", content: text || "(no output)" },
            { role: "user", content: "That was not valid JSON. Return ONLY the JSON object that matches the required schema — no prose." },
          ],
        };
        return claudeGenerate(retry, 1);
      }
      throw new Error("Claude Code did not return the structured JSON that was requested.");
    }
  }
  const usedModel = final.modelUsage ? Object.keys(final.modelUsage)[0] : undefined;
  return {
    text,
    json,
    engine: "claude-cli",
    model: usedModel ?? model,
    usage: {
      inputTokens: final.usage?.input_tokens,
      outputTokens: final.usage?.output_tokens,
      costUsd: typeof final.total_cost_usd === "number" ? final.total_cost_usd : undefined,
    },
  };
}
