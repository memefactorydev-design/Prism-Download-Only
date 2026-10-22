// Engine router for the named agents. Creative and strategy chat runs on the
// active AI engine (src/lib/llm — Claude Code, Codex or the Anthropic API).
// Anything that needs live Google-grounded search uses Gemini when a key is
// connected; without one, Claude Code's own web tools can search; Codex can't.
// Gemini is also the text fallback when no engine is ready at all.

import { getSecrets } from "@/lib/connections";
import { geminiText, type GeminiSource } from "@/lib/gemini";
import { EngineNotReadyError, engineStatus, generateText } from "@/lib/llm";

export interface EngineMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EngineResult {
  text: string;
  sources: GeminiSource[];
  engine: string;
}

export interface GenerateOptions {
  system: string;
  messages: EngineMessage[];
  useSearch?: boolean;
  json?: boolean;
  maxTokens?: number;
}

async function viaEngine(opts: GenerateOptions, tools: "none" | "web"): Promise<EngineResult> {
  const result = await generateText({
    system: opts.system,
    messages: opts.messages,
    tier: "opus",
    model: process.env.NAMED_AGENT_MODEL?.trim() || undefined,
    maxTokens: opts.maxTokens ?? 16_000,
    tools,
    label: tools === "web" ? "named-agent:search" : "named-agent",
  });
  if (!result.text.trim()) throw new Error("The engine returned an empty reply — try again.");
  return { text: result.text, sources: [], engine: result.model ?? result.engine };
}

async function viaGemini(opts: GenerateOptions): Promise<EngineResult> {
  const result = await geminiText({
    system: opts.system,
    messages: opts.messages,
    useSearch: opts.useSearch,
    json: opts.json,
  });
  return { text: result.text, sources: result.sources, engine: result.model };
}

export async function generate(opts: GenerateOptions): Promise<EngineResult> {
  const gemini = await getSecrets("gemini");
  const status = await engineStatus();

  if (!opts.useSearch) {
    if (status.ready) return viaEngine(opts, "none");
    if (gemini?.apiKey) return viaGemini(opts);
    throw new EngineNotReadyError(status.detail);
  }

  // Live search: Gemini's Google grounding first; else Claude Code's web tools.
  if (gemini?.apiKey) return viaGemini(opts);
  if (status.ready && status.engine === "claude-cli") return viaEngine(opts, "web");
  if (!status.ready) throw new EngineNotReadyError(status.detail);
  throw new Error(
    "Live web research needs a Gemini key (Connections) or a Claude Code sign-in — the current engine can't search the web. Turn off live research to chat without it."
  );
}
