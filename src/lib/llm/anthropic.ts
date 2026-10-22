// Engine: the Anthropic API with the workspace's own key (pay-per-token).
// This is the original call path, lifted out of run-agent / engine / builder.

import Anthropic from "@anthropic-ai/sdk";
import { UsageLimitError, USAGE_LIMIT_RE } from "./errors";
import type { EngineStatus, LlmRequest, LlmResult, ModelTier } from "./types";
import { ENGINE_LABELS } from "./types";

// Frontmatter `model:` tier → current model id.
export const MODEL_BY_TIER: Record<ModelTier, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
};

// Server-side tools: Anthropic runs the searches/fetches; results return with
// dynamic filtering built in. No client-side execution needed.
const WEB_TOOLS = [
  { type: "web_search_20260209" as const, name: "web_search" as const },
  { type: "web_fetch_20260209" as const, name: "web_fetch" as const },
];

export function anthropicStatus(hasKey: boolean): EngineStatus {
  return {
    engine: "anthropic-api",
    label: ENGINE_LABELS["anthropic-api"],
    installed: true,
    ready: hasKey,
    detail: hasKey ? "API key connected — billed per token to your Anthropic account." : "No API key (optional).",
    webSearch: true,
    howTo: [
      "Only needed if you prefer Anthropic's pay-per-token API over a Claude Code or Codex sign-in.",
      "Create a key at console.anthropic.com → API Keys and paste it in the Anthropic card below.",
    ],
  };
}

export async function anthropicGenerate(req: LlmRequest, apiKey: string): Promise<LlmResult> {
  const client = new Anthropic({ apiKey });
  const model = req.model ?? MODEL_BY_TIER[req.tier ?? "opus"];
  if (req.schema && req.tools === "web") {
    throw new Error("schema and web tools cannot be combined (citations vs structured outputs).");
  }
  const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }));

  // Stream to avoid HTTP timeouts on long briefs; adaptive thinking for quality.
  // Server-side tools can pause the turn at their iteration limit — re-send the
  // assistant turn to resume (per Anthropic docs, no extra user message).
  let message: Anthropic.Message | undefined;
  let acc = "";
  try {
    for (let continuation = 0; continuation < 6; continuation++) {
      const stream = client.messages.stream({
        model,
        max_tokens: req.maxTokens ?? 16000,
        thinking: { type: "adaptive" },
        system: req.system,
        messages,
        ...(req.tools === "web" ? { tools: WEB_TOOLS } : {}),
        ...(req.schema
          ? { output_config: { format: { type: "json_schema" as const, schema: req.schema } } }
          : {}),
      });
      if (req.onDelta) {
        stream.on("text", (delta) => {
          acc += delta;
          req.onDelta!(acc);
        });
      }
      message = await stream.finalMessage();
      if (message.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: message.content });
    }
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const text = err instanceof Error ? err.message : String(err);
    if (status === 429 || USAGE_LIMIT_RE.test(text)) throw new UsageLimitError("anthropic-api", text);
    throw err;
  }
  if (!message) throw new Error("The model produced no response.");

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  const truncated = message.stop_reason === "max_tokens";
  let json: unknown;
  if (req.schema && text.trim() && !truncated) json = JSON.parse(text);
  return {
    text,
    json,
    truncated,
    engine: "anthropic-api",
    model,
    usage: { inputTokens: message.usage?.input_tokens, outputTokens: message.usage?.output_tokens },
  };
}
