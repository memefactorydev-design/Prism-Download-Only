// The engine layer: every language-model call in Prism goes through ONE
// interface (generateText / generateJson in ./index.ts) backed by one of three
// providers. Two of them bill the user's own subscription by driving a CLI the
// user installed and signed in to themselves (Claude Code, OpenAI Codex); the
// third is the pay-per-token Anthropic API. Rules in AGENTS.md ("Engine layer"):
// Prism never reads or stores CLI credentials, never modifies the binaries, and
// never runs Claude Code in --bare mode (which would drop the subscription login).

export type EngineId = "anthropic-api" | "claude-cli" | "codex-cli";
export const ENGINE_IDS: readonly EngineId[] = ["anthropic-api", "claude-cli", "codex-cli"];
export type EngineMode = "auto" | EngineId;

export function isEngineMode(value: string): value is EngineMode {
  return value === "auto" || (ENGINE_IDS as readonly string[]).includes(value);
}

/** Quality tier from an agent's frontmatter; each engine maps it to a real model. */
export type ModelTier = "opus" | "sonnet" | "haiku";
export const MODEL_TIERS: readonly ModelTier[] = ["opus", "sonnet", "haiku"];

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  /** System prompt: persona + rules. */
  system: string;
  /** Conversation, oldest first; the last entry is the turn to answer. */
  messages: LlmMessage[];
  /** Quality tier (default "opus"). */
  tier?: ModelTier;
  /** Exact model override: an API model id, or a CLI alias / model name. */
  model?: string;
  /** Output budget — honoured by the API; the CLIs size their own output. */
  maxTokens?: number;
  /** JSON Schema: when set, the result carries `json` validated by the engine. */
  schema?: Record<string, unknown>;
  /** Live progress with the accumulated text so far (engines that can stream). */
  onDelta?: (accumulated: string) => void;
  /** "web" lets the model search/fetch the live web where the engine supports it. */
  tools?: "none" | "web";
  timeoutMs?: number;
  /** Short label for logs, e.g. "agent:seo-geo-agent". */
  label?: string;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Client-side estimate where the engine reports one; never a bill. */
  costUsd?: number;
}

export interface LlmResult {
  text: string;
  json?: unknown;
  usage?: LlmUsage;
  engine: EngineId;
  model?: string;
  /** The engine stopped at its output ceiling — `text` is incomplete. */
  truncated?: boolean;
}

export interface EngineStatus {
  engine: EngineId;
  label: string;
  installed: boolean;
  ready: boolean;
  /** One human line: "Signed in with claude.ai (max plan)" / "Not installed". */
  detail: string;
  version?: string;
  authMethod?: string;
  plan?: string;
  model?: string;
  /** Can this engine search the live web on request? */
  webSearch: boolean;
  /** What the user must do to make it ready. */
  howTo: string[];
}

export interface EngineOverview {
  mode: EngineMode;
  active: EngineId | null;
  engines: EngineStatus[];
  checkedAt: string;
}

export const ENGINE_LABELS: Record<EngineId, string> = {
  "anthropic-api": "Anthropic API key",
  "claude-cli": "Claude Code (Claude subscription)",
  "codex-cli": "OpenAI Codex (ChatGPT subscription)",
};
