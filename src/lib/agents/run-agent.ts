// Agent invocation layer: the backend runs the active AI engine (src/lib/llm —
// Claude Code, Codex or the Anthropic API) with the system prompt from the
// matching .claude/agents/*.md file and stores the output as an AgentReport
// row. The dashboard triggers these runs and renders the reports.
//
// Agents are advisors: their outputs become drafts, briefs and pending
// approvals. Execution (posting, spending) happens only in the API layer
// after an explicit dashboard approval.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentReport } from "@prisma/client";
import { db } from "@/lib/db";
import { journal, memoryPromptSuffix } from "@/lib/memory";
import { brandTaskSuffix } from "@/lib/brand-profile";
import { meterUsage } from "@/lib/events";
import { generateText, MODEL_TIERS, type LlmResult, type ModelTier } from "@/lib/llm";

export const AGENT_NAMES = [
  "marketing-supervisor",
  "ad-research-agent",
  "meta-ads-manager",
  "google-ads-manager",
  "lead-scorer-agent",
  "seo-geo-agent",
  "video-editor-agent",
  "voiceover-script-agent",
  "fable-director-agent",
  "tiktok-trend-agent",
  "instagram-trend-agent",
  "youtube-trend-agent",
  "linkedin-trend-agent",
  "pinterest-trend-agent",
  "facebook-trend-agent",
  "ad-video-director-agent",
  "template-research-agent",
  "channel-copy-agent",
  "content-writer-agent",
  "gbp-agent",
  "web-designer-agent",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

interface AgentDefinition {
  /** Quality tier from the frontmatter `model:` line; the engine picks the real model. */
  model: ModelTier;
  systemPrompt: string;
}

export async function loadAgentDefinition(agentName: AgentName): Promise<AgentDefinition> {
  const file = path.join(process.cwd(), ".claude", "agents", `${agentName}.md`);
  const raw = await fs.readFile(file, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${agentName}.md is missing YAML frontmatter.`);
  const tier = match[1].match(/^model:\s*(\S+)/m)?.[1] ?? "sonnet";
  return {
    model: (MODEL_TIERS as readonly string[]).includes(tier) ? (tier as ModelTier) : "sonnet",
    // The human-authored prompt plus everything the agent has learned from its
    // dream cycles (data/pipeline-memory/<name>/) — experience shapes every run.
    systemPrompt: match[2].trim() + memoryPromptSuffix(agentName),
  };
}

export interface AgentRunOptions {
  /** JSON Schema for structured output. When set, the run returns parsed JSON. */
  schema?: Record<string, unknown>;
  /**
   * Let the agent search/fetch the live web (the API's server-side tools, or
   * Claude Code's own WebSearch/WebFetch). Not combinable with schema — web
   * results carry citations, which are incompatible with structured outputs.
   */
  webTools?: boolean;
  /** Output token budget (thinking + response). Defaults to 16000. Raise for
   *  large structured outputs like the video editor's multi-clip plans. */
  maxTokens?: number;
  reportKind: string;
  reportTitle: string;
  /**
   * The data scope this run serves: "" (default) is the workspace. A member's
   * user id redirects the run to THAT user's brand (their /brand profile is
   * appended to the task) and keeps the run out of the agents' dream journals,
   * so beta activity never colours the workspace agents' memory.
   */
  scopeUserId?: string;
  /**
   * Skip the saved brand profile and use the brand-NEUTRAL redirect instead.
   * Required for runs whose whole job is to (re)derive the brand — e.g.
   * website→brand inference: injecting the existing profile would make the
   * model echo the old brand back instead of reading the site.
   */
  brandNeutral?: boolean;
}

export interface AgentRunResult<T = unknown> {
  report: AgentReport;
  data: T | null;
}

export async function runAgent<T = unknown>(
  agentName: AgentName,
  task: string,
  options: AgentRunOptions
): Promise<AgentRunResult<T>> {
  meterUsage(options.scopeUserId ?? "", "agent_run", 1, { agent: agentName });
  if (options.schema && options.webTools) {
    throw new Error("schema and webTools cannot be combined (citations vs structured outputs).");
  }
  const definition = await loadAgentDefinition(agentName);

  // Member scope: redirect the run to the member's own brand (see brand-profile.ts).
  const scope = options.scopeUserId ?? "";
  const scopedTask = task + (await brandTaskSuffix(scope, options.brandNeutral === true));

  const result: LlmResult = await generateText({
    system: definition.systemPrompt,
    messages: [{ role: "user", content: scopedTask }],
    tier: definition.model,
    maxTokens: options.maxTokens ?? 16000,
    schema: options.schema,
    tools: options.webTools ? "web" : "none",
    label: `agent:${agentName}`,
  });

  const text = result.text;
  // Check truncation first — covers the case where reasoning ate the whole
  // budget and no output text was produced.
  if (result.truncated) {
    throw new Error(
      `${agentName} hit the token limit before finishing${
        text.trim() ? "" : " (its reasoning used the whole budget)"
      } — try a shorter source or narrower task.`
    );
  }
  if (!text.trim()) {
    throw new Error(`${agentName} returned no text.`);
  }
  if (options.schema && result.json === undefined) {
    throw new Error(`${agentName} did not return the structured JSON that was requested.`);
  }

  const data = options.schema ? (result.json as T) : null;
  // For structured runs the human-readable report is in the parsed payload
  // (reportMarkdown by convention); fall back to raw text.
  const content =
    data && typeof (data as Record<string, unknown>).reportMarkdown === "string"
      ? ((data as Record<string, unknown>).reportMarkdown as string)
      : text;

  const report = await db.agentReport.create({
    data: {
      agentName,
      kind: options.reportKind,
      title: options.reportTitle,
      content,
      data: data ? JSON.stringify(data) : null,
    },
  });
  // Journal the run so the agent can replay it in its nightly dream cycle —
  // workspace runs only: beta users' runs must not colour the agents' memory.
  if (scope === "") {
    journal(agentName, {
      kind: "run",
      reportKind: options.reportKind,
      task: task.slice(0, 800),
      excerpt: content.slice(0, 1200),
    });
  }
  return { report, data };
}
