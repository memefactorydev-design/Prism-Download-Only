// The one door every language-model call goes through. Picks the engine
// (env LLM_ENGINE → DB setting → auto-detect), caches what is installed and
// signed in, and routes generateText / generateJson to the provider.

import { db } from "@/lib/db";
import { getSecrets } from "@/lib/connections";
import { anthropicGenerate, anthropicStatus } from "./anthropic";
import { claudeGenerate, claudeStatus } from "./claude-cli";
import { codexGenerate, codexStatus } from "./codex-cli";
import { EngineNotReadyError } from "./errors";
import { pickActive } from "./select";
import { withSlot } from "./spawn";
import type { EngineId, EngineMode, EngineOverview, LlmRequest, LlmResult } from "./types";
import { ENGINE_IDS, isEngineMode } from "./types";

export * from "./types";
export * from "./errors";
export { pickActive } from "./select";
export { lastClaudeRateLimit } from "./claude-cli";
export { MODEL_BY_TIER } from "./anthropic";

const SETTING_KEY = "llm_engine";
const CACHE_MS = 60_000;

let cache: { at: number; overview: EngineOverview } | null = null;

/** Where the engine choice comes from: env wins, then the dashboard setting, then auto. */
export async function engineMode(): Promise<EngineMode> {
  const env = process.env.LLM_ENGINE?.trim();
  if (env && isEngineMode(env)) return env;
  const row = await db.setting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
  return row && isEngineMode(row.value) ? row.value : "auto";
}

export function engineModeLockedByEnv(): boolean {
  const env = process.env.LLM_ENGINE?.trim();
  return Boolean(env && isEngineMode(env));
}

export async function setEngineMode(mode: EngineMode): Promise<void> {
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: mode },
    update: { value: mode },
  });
  cache = null;
}

/** Everything the Connections page shows. Cached for a minute — the status
 *  commands spawn the CLIs, which is cheap but not free. */
export async function engineOverview(force = false): Promise<EngineOverview> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.overview;
  const [mode, key, claude, codex] = await Promise.all([
    engineMode(),
    getSecrets("anthropic").catch(() => null),
    claudeStatus(),
    codexStatus(),
  ]);
  const engines = [anthropicStatus(Boolean(key?.apiKey)), claude, codex];
  const overview: EngineOverview = {
    mode,
    active: pickActive(mode, engines),
    engines,
    checkedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), overview };
  return overview;
}

export function forgetEngineCache(): void {
  cache = null;
}

export interface EngineReadiness {
  engine: EngineId | null;
  ready: boolean;
  /** True when the active engine bills a subscription rather than per token. */
  isCli: boolean;
  detail: string;
}

export async function engineStatus(): Promise<EngineReadiness> {
  const overview = await engineOverview();
  if (!overview.active) return { engine: null, ready: false, isCli: false, detail: engineNotReadyMessage(overview) };
  const status = overview.engines.find((e) => e.engine === overview.active)!;
  return { engine: overview.active, ready: true, isCli: overview.active !== "anthropic-api", detail: status.detail };
}

export async function engineReady(): Promise<boolean> {
  return (await engineStatus()).ready;
}

export function engineNotReadyMessage(overview?: EngineOverview): string {
  if (overview && overview.mode !== "auto") {
    const s = overview.engines.find((e) => e.engine === overview.mode);
    return `The selected AI engine (${s?.label ?? overview.mode}) is not ready: ${s?.detail ?? "unknown"} Fix it or pick another engine on the Connections page.`;
  }
  return "No AI engine is ready. Sign in to Claude Code (`claude auth login`) or Codex (`codex login`) on this machine, or add an Anthropic API key — all on the Connections page.";
}

/** Generate text (or, with `schema`, validated JSON in `json`) on the active engine. */
export async function generateText(req: LlmRequest): Promise<LlmResult> {
  const overview = await engineOverview();
  const engine = overview.active;
  if (!engine) throw new EngineNotReadyError(engineNotReadyMessage(overview));
  switch (engine) {
    case "anthropic-api": {
      const secrets = await getSecrets("anthropic");
      if (!secrets?.apiKey) {
        cache = null;
        throw new EngineNotReadyError("The Anthropic API key was removed. Reconnect it, or sign in to Claude Code or Codex.");
      }
      return anthropicGenerate(req, secrets.apiKey);
    }
    case "claude-cli":
      return withSlot(() => claudeGenerate(req));
    case "codex-cli":
      return withSlot(() => codexGenerate(req));
  }
}

export async function generateJson<T = unknown>(
  req: LlmRequest & { schema: Record<string, unknown> }
): Promise<LlmResult & { json: T }> {
  const result = await generateText(req);
  if (result.json === undefined) {
    throw new Error(`${req.label ?? "The model"} did not return the structured JSON that was requested.`);
  }
  return result as LlmResult & { json: T };
}

export interface EngineTestResult {
  engine: EngineId;
  model?: string;
  text: string;
  ms: number;
  usage?: LlmResult["usage"];
}

/** A one-line generation on the cheapest tier — the "Run a test" button. */
export async function testEngine(): Promise<EngineTestResult> {
  const started = Date.now();
  const result = await generateText({
    system: "You are the self-test of an application's AI engine. Reply in one short, friendly sentence.",
    messages: [{ role: "user", content: "Confirm you are working and say which model family you are, in under fifteen words." }],
    tier: "haiku",
    timeoutMs: 120_000,
    label: "engine:test",
  });
  return { engine: result.engine, model: result.model, text: result.text.trim(), ms: Date.now() - started, usage: result.usage };
}

export const ALL_ENGINES = ENGINE_IDS;
