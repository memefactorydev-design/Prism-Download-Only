// Engine: OpenAI Codex (`codex exec`) — bills the user's own ChatGPT plan via
// the sign-in they completed with `codex login`. Prism only spawns the binary;
// it never reads ~/.codex/auth.json. `--ignore-user-config` keeps the user's
// MCP servers, plugins and skills out of every generation (they cost thousands
// of prompt tokens and have nothing to do with marketing copy); the user's
// chosen model is still honoured by reading only the `model` keys of
// ~/.codex/config.toml.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { UsageLimitError, USAGE_LIMIT_RE, usageLimitMessage } from "./errors";
import { findBinary, llmWorkDir, makeTempDir, removeDir, runProcess } from "./spawn";
import { parseJsonLoose, renderTranscript } from "./transcript";
import type { EngineStatus, LlmRequest, LlmResult } from "./types";
import { ENGINE_LABELS } from "./types";

const HOW_TO = [
  "Install Codex: npm install -g @openai/codex",
  "Sign in with your ChatGPT Plus/Pro account: codex login",
  "Keep the app and the worker running in a shell where `codex` is on PATH (or set CODEX_BIN).",
];

interface CodexUserModel {
  model?: string;
  effort?: string;
}

/** The user's preferred model from ~/.codex/config.toml (never the auth file). */
async function userModelConfig(): Promise<CodexUserModel> {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  try {
    const toml = await fs.readFile(path.join(home, "config.toml"), "utf8");
    const model = toml.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1];
    const effort = toml.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1];
    return { model, effort };
  } catch {
    return {};
  }
}

async function modelFor(req: LlmRequest): Promise<CodexUserModel> {
  const user = await userModelConfig();
  if (req.model) return { model: req.model, effort: user.effort };
  const tier = req.tier ?? "opus";
  const fast = process.env.CODEX_MODEL_FAST?.trim();
  if ((tier === "haiku" || tier === "sonnet") && fast) return { model: fast, effort: user.effort };
  const main = process.env.CODEX_MODEL?.trim() || user.model;
  return { model: main, effort: process.env.CODEX_REASONING_EFFORT?.trim() || user.effort };
}

export async function codexStatus(): Promise<EngineStatus> {
  const base: EngineStatus = {
    engine: "codex-cli",
    label: ENGINE_LABELS["codex-cli"],
    installed: false,
    ready: false,
    detail: "Not installed.",
    webSearch: false,
    howTo: HOW_TO,
  };
  const bin = await findBinary("codex", process.env.CODEX_BIN);
  if (!bin) return base;
  base.installed = true;
  try {
    const [ver, login] = await Promise.all([
      runProcess({ bin, args: ["--version"], timeoutMs: 20_000 }),
      runProcess({ bin, args: ["login", "status"], timeoutMs: 30_000 }),
    ]);
    base.version = ver.stdout.trim().replace(/^codex-cli\s*/i, "") || undefined;
    const line = `${login.stdout}\n${login.stderr}`.trim();
    const { model } = await modelFor({ system: "", messages: [] });
    base.model = model ?? "(Codex default)";
    if (login.code === 0) {
      base.ready = true;
      const method = /chatgpt/i.test(line) ? "ChatGPT" : /api key/i.test(line) ? "API key" : undefined;
      base.authMethod = method?.toLowerCase();
      base.detail = method ? `Signed in with ${method}.` : "Signed in.";
      if (method === "API key") base.detail += " Note: this sign-in bills the API, not a subscription.";
    } else {
      base.detail = "Installed but not signed in — run `codex login`.";
    }
  } catch (err) {
    base.detail = `Installed, but it failed to answer: ${err instanceof Error ? err.message : String(err)}`;
  }
  return base;
}

function wrapPrompt(req: LlmRequest): string {
  const notes = [
    "You are answering inside another application, not in a coding session. Do not run commands, read files or explore the working directory; produce the answer directly.",
    req.schema
      ? "Your entire reply must be exactly one JSON object that matches the required output schema — no prose, no code fences."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [
    "<system_instructions>",
    req.system.trim(),
    "",
    notes,
    "</system_instructions>",
    "",
    "<task>",
    renderTranscript(req.messages),
    "</task>",
    "",
  ].join("\n");
}

export interface CodexStreamState {
  /** The last agent_message text (Codex emits whole messages, not deltas). */
  text: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  failure: string | null;
}

/** One line of `codex exec --json` stdout (JSONL events). Pure, unit-tested. */
export function handleCodexLine(line: string, state: CodexStreamState): void {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = obj.type;
  if (type === "item.completed") {
    const item = obj.item as { type?: string; text?: string } | undefined;
    if (item?.type === "agent_message" && typeof item.text === "string") state.text = item.text;
  } else if (type === "turn.completed") {
    state.usage = obj.usage as CodexStreamState["usage"];
  } else if (type === "turn.failed" || type === "error") {
    const err = (obj.error ?? obj) as { message?: string };
    state.failure = err?.message ?? JSON.stringify(obj).slice(0, 400);
  }
}

export async function codexGenerate(req: LlmRequest, attempt = 0): Promise<LlmResult> {
  const bin = await findBinary("codex", process.env.CODEX_BIN);
  if (!bin) throw new Error("Codex is not installed (npm install -g @openai/codex).");
  const { model, effort } = await modelFor(req);
  const tmp = await makeTempDir();
  const schemaPath = path.join(tmp, "schema.json");
  if (req.schema) await fs.writeFile(schemaPath, JSON.stringify(req.schema), "utf8");
  const cwd = await llmWorkDir();

  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-rules",
    "--ignore-user-config",
    "-s",
    "read-only",
    "-C",
    cwd,
    ...(model ? ["-m", model] : []),
    ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
    ...(req.schema ? ["--output-schema", schemaPath] : []),
    "-",
  ];

  const state: CodexStreamState = { text: "", failure: null };
  let run;
  try {
    run = await runProcess({
      bin,
      args,
      stdin: wrapPrompt(req),
      cwd,
      timeoutMs: req.timeoutMs,
      onStdoutLine: (line) => handleCodexLine(line, state),
    });
  } finally {
    await removeDir(tmp);
  }

  if (run.timedOut) {
    throw new Error(`Codex timed out after ${Math.round((req.timeoutMs ?? 600_000) / 1000)}s${req.label ? ` (${req.label})` : ""}.`);
  }
  const { text, usage, failure } = state;
  if (failure || (!text && run.code !== 0)) {
    const msg = failure ?? (run.stderr.trim().slice(-800) || "unknown error");
    if (USAGE_LIMIT_RE.test(msg)) throw new UsageLimitError("codex-cli", usageLimitMessage("codex-cli"));
    throw new Error(`Codex: ${msg.slice(0, 600)}`);
  }
  if (!text.trim()) throw new Error("Codex returned no answer.");

  let json: unknown;
  if (req.schema) {
    try {
      json = parseJsonLoose(text);
    } catch {
      if (attempt === 0) {
        const retry: LlmRequest = {
          ...req,
          messages: [
            ...req.messages,
            { role: "assistant", content: text },
            { role: "user", content: "That was not valid JSON. Return ONLY the JSON object that matches the required schema — no prose." },
          ],
        };
        return codexGenerate(retry, 1);
      }
      throw new Error("Codex did not return the structured JSON that was requested.");
    }
  }
  req.onDelta?.(text); // Codex emits whole messages, so progress arrives in one step.
  return {
    text,
    json,
    engine: "codex-cli",
    model,
    usage: { inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens },
  };
}
