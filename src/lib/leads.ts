// Leads CRM core: validated statuses, transparent heuristic scoring on
// capture (a rule-based scorer, brand-agnostic by design),
// and an agent deep-score on demand. Scoped per user like everything else.

import type { Lead } from "@prisma/client";
import { db } from "@/lib/db";
import { runAgent } from "@/lib/agents/run-agent";
import { journal } from "@/lib/memory";
import { track } from "@/lib/events";

export const LEAD_STATUSES = ["new", "contacted", "booked", "lost", "callback", "no_contact"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  booked: "Booked",
  lost: "Lost",
  callback: "Callback",
  no_contact: "No Contact",
};

export const LEAD_SOURCES = ["manual", "webhook", "site", "import", "meta", "google", "referral"] as const;

export interface LeadInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  detail?: string;
  subscribed?: boolean;
}

/**
 * Instant, transparent heuristic (0–100): contactability + context richness +
 * source quality. Cheap and honest — the agent deep-score refines it on demand.
 */
export function heuristicScore(l: LeadInput): { score: number; reason: string } {
  let score = 20; // it's a real enquiry
  const parts: string[] = [];

  const email = l.email?.trim() ?? "";
  const phone = (l.phone ?? "").replace(/\D/g, "");
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    score += 10;
    if (!/gmail|yahoo|hotmail|outlook|icloud/i.test(email)) score += 5; // company domain
  }
  if (phone.length >= 9) score += 15;
  if (email && phone.length >= 9) parts.push("fully contactable");
  else if (!email && phone.length < 9) parts.push("hard to contact");

  const detail = l.detail?.trim() ?? "";
  if (detail.length > 200) {
    score += 25;
    parts.push("rich detail");
  } else if (detail.length > 60) {
    score += 15;
    parts.push("some context");
  } else if (detail.length > 0) score += 6;
  else parts.push("no context given");
  if (/budget|£|\$|quote|price|book|appointment|consult/i.test(detail)) {
    score += 10;
    parts.push("buying signals");
  }

  const source = l.source ?? "manual";
  if (source === "referral") score += 15;
  else if (source === "site" || source === "webhook") score += 10;
  else if (source === "meta" || source === "google") score += 8;

  return { score: Math.min(100, score), reason: `Heuristic: ${parts.join(", ") || "baseline enquiry"}.` };
}

export async function createLead(input: LeadInput, scopeUserId = ""): Promise<Lead> {
  track("lead_created", scopeUserId, { source: input.source ?? "manual" });
  if (!input.name?.trim()) throw new Error("The lead needs a name.");
  const source = (LEAD_SOURCES as readonly string[]).includes(input.source ?? "") ? input.source! : "manual";
  const { score, reason } = heuristicScore({ ...input, source });
  return db.lead.create({
    data: {
      userId: scopeUserId,
      name: input.name.trim().slice(0, 140),
      email: input.email?.trim().toLowerCase().slice(0, 200) || null,
      phone: input.phone?.trim().slice(0, 40) || null,
      company: input.company?.trim().slice(0, 140) || null,
      source,
      detail: input.detail?.trim().slice(0, 4000) || null,
      subscribed: input.subscribed !== false,
      score,
      scoreReason: reason,
    },
  });
}

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number", description: "0-100 lead quality per the rubric." },
    reason: { type: "string", description: "ONE actionable sentence explaining the score." },
    nextAction: { type: "string", description: "One concrete next step for the salesperson." },
  },
  required: ["score", "reason", "nextAction"],
  additionalProperties: false,
};

/** Agent deep-score: reads the whole lead and returns score + reason + next action. */
export async function agentScoreLead(id: string, scopeUserId = ""): Promise<Lead> {
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) throw new Error("Lead not found.");

  const task = [
    "Score this lead per your rubric.",
    "",
    "```json",
    JSON.stringify(
      {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        company: lead.company,
        source: lead.source,
        detail: lead.detail,
        capturedAt: lead.createdAt,
        currentStatus: lead.status,
      },
      null,
      2
    ),
    "```",
  ].join("\n");

  const { data } = await runAgent<{ score: number; reason: string; nextAction: string }>(
    "lead-scorer-agent",
    task,
    {
      schema: SCORE_SCHEMA,
      maxTokens: 2000,
      reportKind: "lead_score",
      reportTitle: `Lead score: ${lead.name}`,
      scopeUserId,
    }
  );
  if (!data) throw new Error("lead-scorer-agent returned nothing.");

  const score = Math.max(0, Math.min(100, Math.round(data.score)));
  return db.lead.update({
    where: { id },
    data: { score, scoreReason: `${data.reason} Next: ${data.nextAction}` },
  });
}

export async function updateLeadStatus(id: string, status: string, scopeUserId: string, isAdmin: boolean): Promise<Lead> {
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Status must be one of: ${LEAD_STATUSES.join(", ")}`);
  }
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead || (!isAdmin && lead.userId !== scopeUserId)) throw new Error("Lead not found.");
  const updated = await db.lead.update({
    where: { id },
    data: { status, lastTouch: new Date() },
  });
  // Booked/lost outcomes are honest pipeline feedback for the workspace agents.
  if (lead.userId === "" && (status === "booked" || status === "lost")) {
    journal("marketing-supervisor", {
      kind: "outcome",
      item: "lead",
      title: `${lead.name} (${lead.source})`,
      status,
    });
  }
  return updated;
}
