// The named agent team (Scout, Harriet, Pia, Isla, Felix, Yara, Kai, Nova,
// Otto, Magnus, Lydia). Each agent is defined by markdown files in agents/<id>/ —
//   AGENT.md  — mission, responsibilities, KPIs, workflows
//   SOUL.md   — personality, voice & tone
//   SKILLS.md — tactical platform playbooks
// plus the shared agents/BRAND.md (how to read the brief), and two files the
// agent maintains itself during dream cycles (see memory.ts):
//   MEMORY.md    — accumulated context
//   LEARNINGS.md — self-taught playbook from user feedback
// The BUSINESS the team works for is data, not prose: the scope's BrandProfile
// is rendered into a brief (src/lib/brand-profile.ts) and injected here, so the
// same files serve any brand. Edit the files and the agent changes behaviour
// instantly — no restart needed.

import fs from "node:fs";
import path from "node:path";
import { brandBriefFor, getBrandProfile } from "@/lib/brand-profile";

export const AGENTS_DIR = path.join(process.cwd(), "agents");

export interface NamedAgent {
  id: string;
  name: string;
  title: string;
  platform: string;
  emoji: string;
  color: string;
  tagline: string;
}

export function roster(): NamedAgent[] {
  return JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "roster.json"), "utf8")) as NamedAgent[];
}

export function getAgent(agentId: string): NamedAgent {
  const agent = roster().find((a) => a.id === agentId);
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  return agent;
}

function readIfExists(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** The full system prompt for a named agent, briefed on the scope's brand
 *  ("" = the workspace). */
export async function systemPrompt(agentId: string, scopeUserId = ""): Promise<string> {
  const agents = roster();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);

  const dir = path.join(AGENTS_DIR, agentId);
  const brandRules = readIfExists(path.join(AGENTS_DIR, "BRAND.md"));
  const parts = ["AGENT.md", "SOUL.md", "SKILLS.md"]
    .map((f) => readIfExists(path.join(dir, f)))
    .filter(Boolean);

  // Agent-owned files, written by the agent itself during dream cycles.
  const memory = readIfExists(path.join(dir, "MEMORY.md"));
  const learnings = readIfExists(path.join(dir, "LEARNINGS.md"));
  if (memory) {
    parts.push(
      `# Your memory\nEverything below is context you accumulated in past sessions — trust it and build on it.\n\n${memory}`
    );
  }
  if (learnings) {
    parts.push(
      `# Your learnings\nRules and tactics you taught yourself from real outcomes and user feedback — apply them.\n\n${learnings}`
    );
  }

  const [profile, brief] = await Promise.all([getBrandProfile(scopeUserId), brandBriefFor(scopeUserId)]);
  const business = profile?.businessName ?? "the business this workspace is being set up for";
  const header = [
    `You are ${agent.name}, the ${agent.title} for ${business}${profile?.siteUrl ? ` (${profile.siteUrl})` : ""}.`,
    `You are part of Prism AI, ${profile ? `${business}'s` : "the"} marketing platform — a team of specialist AI marketing agents.`,
    `Teammates you can reference: ${agents.map((a) => `${a.name} (${a.title})`).join(", ")}.`,
    `Be specific, tactical and ready-to-use — deliver finished copy, plans and checklists, not generic advice.`,
  ].join("\n");

  return [header, brandRules, brief, ...parts].filter(Boolean).join("\n\n---\n\n");
}
