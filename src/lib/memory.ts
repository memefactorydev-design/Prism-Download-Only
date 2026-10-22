// Named-agent memory, journaling and dreaming — ported intact from the original
// the marketing suite.
//
// Each agent owns two markdown files it maintains itself (the human-authored
// AGENT/SOUL/SKILLS files are never touched by the system):
//   agents/<id>/MEMORY.md    — accumulated context: facts, decisions, preferences
//   agents/<id>/LEARNINGS.md — self-improvement playbook: what works, what to avoid
// Both are appended to the agent's system prompt, so memory shapes every reply.
//
// Raw material comes from a journal (data/journal/<id>.jsonl): every chat,
// feedback rating, saved note and intel brief is logged as one line. Dreaming
// replays the journal since the last dream and rewrites both files. Deliberately
// file-based rather than Prisma: the files are user-editable, portable, and the
// journal is append-only — a database adds nothing here.

import fs from "node:fs";
import path from "node:path";
import { AGENTS_DIR, roster, systemPrompt } from "@/lib/named-agents";
import { generate } from "@/lib/engine";
import { engineStatus } from "@/lib/llm";
import { brandTaskSuffix } from "@/lib/brand-profile";
import { parseModelJson } from "@/lib/gemini";

const DATA_DIR = path.join(process.cwd(), "data");
const JOURNAL_DIR = path.join(DATA_DIR, "journal");
const DREAMS_FILE = path.join(DATA_DIR, "dreams.json");
const STATE_FILE = path.join(DATA_DIR, "agent-state.json");

// Pipeline agents (.claude/agents/*.md) learn too, but their prompt files are
// human-authored — the machine-owned memory lives here instead.
const PIPELINE_MEMORY_DIR = path.join(DATA_DIR, "pipeline-memory");
const PIPELINE_AGENTS_DIR = path.join(process.cwd(), ".claude", "agents");

function isPipelineAgent(agentId: string): boolean {
  return fs.existsSync(path.join(PIPELINE_AGENTS_DIR, `${agentId}.md`));
}

export function pipelineAgentNames(): string[] {
  try {
    return fs
      .readdirSync(PIPELINE_AGENTS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

/** "ad-research-agent" → "Ad Research Agent" for display. */
export function pipelineDisplayName(agentId: string): string {
  return agentId
    .split("-")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function ensureDirs(): void {
  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
}

const clip = (s: unknown, n = 2500): string => {
  const str = String(s ?? "");
  return str.length > n ? `${str.slice(0, n)}\n…[truncated]` : str;
};

// ─── journal ─────────────────────────────────────────────────────────────────

export interface JournalEntry {
  ts: string;
  kind: "chat" | "feedback" | "note" | "intel" | "dream" | string;
  [key: string]: unknown;
}

export function journal(agentId: string, entry: Omit<JournalEntry, "ts">): void {
  ensureDirs();
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  fs.appendFileSync(path.join(JOURNAL_DIR, `${agentId}.jsonl`), line + "\n");
}

export function readJournal(agentId: string, sinceIso?: string | null): JournalEntry[] {
  let raw = "";
  try {
    raw = fs.readFileSync(path.join(JOURNAL_DIR, `${agentId}.jsonl`), "utf8");
  } catch {
    return [];
  }
  const entries: JournalEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as JournalEntry;
      if (!sinceIso || e.ts > sinceIso) entries.push(e);
    } catch {
      // skip corrupt lines
    }
  }
  return entries;
}

// ─── memory files ────────────────────────────────────────────────────────────

export interface AgentMemory {
  memory: string;
  learnings: string;
}

function memoryDirFor(agentId: string): string {
  return isPipelineAgent(agentId)
    ? path.join(PIPELINE_MEMORY_DIR, agentId)
    : path.join(AGENTS_DIR, agentId);
}

export function readMemory(agentId: string): AgentMemory {
  const dir = memoryDirFor(agentId);
  const read = (file: string) => {
    try {
      return fs.readFileSync(path.join(dir, file), "utf8");
    } catch {
      return "";
    }
  };
  return { memory: read("MEMORY.md"), learnings: read("LEARNINGS.md") };
}

/**
 * The "# Your memory / # Your learnings" block appended to an agent's system
 * prompt — how accumulated experience shapes every subsequent run.
 */
export function memoryPromptSuffix(agentId: string): string {
  const { memory, learnings } = readMemory(agentId);
  const parts: string[] = [];
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
  return parts.length ? `\n\n---\n\n${parts.join("\n\n---\n\n")}` : "";
}

export function writeMemory(agentId: string, files: Partial<AgentMemory>): void {
  const dir = memoryDirFor(agentId);
  fs.mkdirSync(dir, { recursive: true });
  // Hard cap so a runaway model response can never bloat the system prompt.
  if (typeof files.memory === "string") {
    fs.writeFileSync(path.join(dir, "MEMORY.md"), clip(files.memory, 12_000));
  }
  if (typeof files.learnings === "string") {
    fs.writeFileSync(path.join(dir, "LEARNINGS.md"), clip(files.learnings, 12_000));
  }
}

/** Instantly append a dated note to MEMORY.md (the chat "remember this" button). */
export function remember(agentId: string, text: string): void {
  const { memory } = readMemory(agentId);
  const date = new Date().toISOString().slice(0, 10);
  const base =
    memory.trim() || "# Memory\n\nAccumulated context — maintained by me and consolidated while I dream.";
  writeMemory(agentId, {
    memory: `${base}\n\n- (${date}) ${clip(text, 1500).replace(/\s+/g, " ")}`,
  });
  journal(agentId, { kind: "note", text: clip(text, 1500) });
}

// ─── dream state & records ───────────────────────────────────────────────────

export interface DreamRecord {
  id: string;
  agentId: string;
  agentName: string;
  ts: string;
  report: string;
  ideas: string[];
  entryCount: number;
  engine: string;
}

interface AgentState {
  _lastNightly?: string;
  [agentId: string]: { lastDream?: string } | string | undefined;
}

function readState(): AgentState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as AgentState;
  } catch {
    return {};
  }
}

function writeState(state: AgentState): void {
  ensureDirs();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function listDreams(): DreamRecord[] {
  try {
    return JSON.parse(fs.readFileSync(DREAMS_FILE, "utf8")) as DreamRecord[];
  } catch {
    return [];
  }
}

export function lastDream(agentId: string): string | null {
  const s = readState()[agentId];
  return typeof s === "object" && s?.lastDream ? s.lastDream : null;
}

// ─── dreaming ────────────────────────────────────────────────────────────────

function journalDigest(entries: JournalEntry[]): string {
  return entries
    .map((e) => {
      const when = e.ts.slice(0, 16).replace("T", " ");
      if (e.kind === "chat") {
        return `[${when}] CHAT${e.useSearch ? " (live research)" : ""}\n  User: ${clip(e.user, 700)}\n  You replied: ${clip(e.reply, 900)}`;
      }
      if (e.kind === "feedback") {
        return `[${when}] FEEDBACK ${e.rating === "up" ? "👍 approved" : "👎 rejected"}${e.note ? ` — "${clip(e.note, 300)}"` : ""}\n  On your reply to: ${clip(e.question, 300)}`;
      }
      if (e.kind === "note") return `[${when}] USER SAVED TO YOUR MEMORY: ${clip(e.text, 500)}`;
      if (e.kind === "intel") {
        return `[${when}] PLATFORM INTEL SCRAPED (${e.source}, ${e.itemCount} items) — brief:\n  ${clip(e.excerpt, 900)}`;
      }
      if (e.kind === "adpack") {
        return `[${when}] AD PACK for ${e.platform} — objective: ${e.objective}, offer: ${e.offer || "n/a"}\n  Strategy used: ${clip(e.strategy, 400)}`;
      }
      if (e.kind === "run") {
        return `[${when}] RUN (${e.reportKind})\n  Task: ${clip(e.task, 500)}\n  You produced: ${clip(e.excerpt, 700)}`;
      }
      if (e.kind === "outcome") {
        return `[${when}] REAL-WORLD OUTCOME — ${e.item} "${clip(e.title, 150)}" → ${e.status}${e.detail ? ` (${clip(e.detail, 250)})` : ""}. This is genuine user/world feedback on your past output — weigh it heavily.`;
      }
      return `[${when}] ${e.kind}: ${clip(JSON.stringify(e), 300)}`;
    })
    .join("\n\n");
}

function dreamPrompt(entries: JournalEntry[]): string {
  return `It is night. The day's work is done and it is time for your dream cycle — the ritual where you replay everything that happened, consolidate it into memory, and sharpen how you work.

Below is your activity journal since your last dream (${entries.length} entries). Your current MEMORY.md and LEARNINGS.md are already part of your system prompt above — treat them as what you knew going to sleep.

=== JOURNAL ===
${clip(journalDigest(entries), 24_000)}
=== END JOURNAL ===

Dream now. Return STRICT JSON only, with this exact shape:
{
  "dream": "Your dream report in markdown. Written in first person, in your own voice. Cover: what you replayed from the day, patterns you noticed, what worked and what fell flat (weigh 👎 feedback heavily), connections between ideas, and finish with a '## Tomorrow' section of 3-5 specific, creative, actionable ideas for the brand's marketing (the business in your brand brief).",
  "memory": "The complete new contents of your MEMORY.md — durable facts and context only: brand decisions, user preferences, campaign facts, things you were told to remember. Merge new knowledge into what you already had, prune anything stale or superseded. Keep dated bullets. Under 5000 characters.",
  "learnings": "The complete new contents of your LEARNINGS.md — your self-written playbook: tactics that got approval, phrasings/angles that were rejected and why, rules you set yourself for next time. Refine existing rules rather than repeating them. Under 5000 characters.",
  "ideas": ["3-5 short one-line ideas matching the Tomorrow section"]
}

Rules: UK English. Be specific — name the actual topics, platforms and feedback from the journal, never generic filler. If the journal is thin, keep the dream short and honest. Never invent feedback that did not happen.`;
}

export interface DreamOutcome {
  agentId: string;
  skipped?: boolean;
  reason?: string;
  record?: DreamRecord;
}

export interface DreamSubject {
  id: string;
  name: string;
}

/** System prompt for a dream: named agents have their full persona prompt;
 *  pipeline agents get their .claude/agents definition + accumulated memory. */
async function dreamSystem(agentId: string): Promise<string> {
  // Dreams are workspace-only, so both kinds of agent are briefed on the
  // workspace brand ("" scope).
  if (!isPipelineAgent(agentId)) return systemPrompt(agentId, "");
  const raw = fs.readFileSync(path.join(PIPELINE_AGENTS_DIR, `${agentId}.md`), "utf8");
  const body = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)?.[1] ?? raw;
  return body.trim() + memoryPromptSuffix(agentId) + (await brandTaskSuffix(""));
}

/** Run one agent's dream cycle. Skips when there's nothing new to dream about.
 *  Works for both named agents and pipeline agents. */
export async function dream(agent: DreamSubject): Promise<DreamOutcome> {
  const state = readState();
  const prior = state[agent.id];
  const since = typeof prior === "object" ? prior?.lastDream : undefined;
  const entries = readJournal(agent.id, since).filter((e) => e.kind !== "dream");
  if (!entries.length) {
    return { agentId: agent.id, skipped: true, reason: "No new activity since last dream." };
  }

  const result = await generate({
    system: await dreamSystem(agent.id),
    messages: [{ role: "user", content: dreamPrompt(entries) }],
    json: true,
  });
  const parsed = parseModelJson<{ dream?: string; memory?: string; learnings?: string; ideas?: unknown[] }>(
    result.text
  );

  writeMemory(agent.id, { memory: parsed.memory, learnings: parsed.learnings });

  const record: DreamRecord = {
    id: `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    agentId: agent.id,
    agentName: agent.name,
    ts: new Date().toISOString(),
    report: parsed.dream ?? "",
    ideas: Array.isArray(parsed.ideas) ? parsed.ideas.map((i) => String(i)) : [],
    entryCount: entries.length,
    engine: result.engine,
  };
  ensureDirs();
  const dreams = [record, ...listDreams()].slice(0, 200);
  fs.writeFileSync(DREAMS_FILE, JSON.stringify(dreams, null, 2));

  state[agent.id] = { ...(typeof prior === "object" ? prior : {}), lastDream: record.ts };
  writeState(state);

  journal(agent.id, { kind: "dream", ideas: record.ideas.slice(0, 5) });
  return { agentId: agent.id, record };
}

/** Everyone who can dream: the 11 named agents + every pipeline agent. */
export function allDreamSubjects(): DreamSubject[] {
  return [
    ...roster().map((a) => ({ id: a.id, name: a.name })),
    ...pipelineAgentNames().map((n) => ({ id: n, name: pipelineDisplayName(n) })),
  ];
}

/**
 * Nightly tick — called by the worker every minute. At the configured hour
 * (DREAM_HOUR, default 3), every agent — named team AND pipeline agents —
 * with new journal activity dreams once.
 */
export async function dreamTick(): Promise<void> {
  const dreamHour = Number.parseInt(process.env.DREAM_HOUR ?? "3", 10);
  const now = new Date();
  if (now.getHours() !== dreamHour) return;

  const state = readState();
  const today = now.toISOString().slice(0, 10);
  if (state._lastNightly === today) return;
  state._lastNightly = today;
  writeState(state);

  // A subscription engine shares one usage window with the owner's own work,
  // so a night is capped (DREAMS_MAX_PER_NIGHT, default 8 on Claude Code /
  // Codex, unlimited on the API). Agents left over simply dream another night.
  const engine = await engineStatus();
  const cap = Number.parseInt(process.env.DREAMS_MAX_PER_NIGHT ?? "", 10);
  const maxDreams = Number.isFinite(cap) && cap > 0 ? cap : engine.isCli ? 8 : Number.POSITIVE_INFINITY;
  let dreamed = 0;
  let deferred = 0;

  for (const agent of allDreamSubjects()) {
    if (dreamed >= maxDreams) {
      deferred++;
      continue;
    }
    try {
      const outcome = await dream(agent);
      if (!outcome.skipped) {
        dreamed++;
        console.log(`☾ ${agent.name} dreamed (${outcome.record?.entryCount} journal entries)`);
      }
    } catch (err) {
      console.error(`dream ${agent.id}:`, err instanceof Error ? err.message : err);
    }
  }
  if (deferred) console.log(`☾ ${deferred} agent(s) deferred to another night (DREAMS_MAX_PER_NIGHT=${maxDreams}).`);
}
