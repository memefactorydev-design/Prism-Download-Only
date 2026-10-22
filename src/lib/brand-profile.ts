// The brand every agent researches and writes FOR. One BrandProfile row per
// scope: "" is the workspace (the owner's business, captured once at /welcome),
// any other userId is a member's own brand. The row is rendered into the BRAND
// BRIEF (brand-brief.ts) — the only place business facts enter a prompt. Prompt
// files (agents/, .claude/agents/) are brand-agnostic and read the brief's headings.

import type { BrandProfile } from "@prisma/client";
import { db } from "@/lib/db";
import { NEUTRAL_BRAND_NOTE, renderBrandBrief, WITHHELD_BRAND_NOTE } from "@/lib/brand-brief";

export { renderBrandBrief, NEUTRAL_BRAND_NOTE } from "@/lib/brand-brief";

export interface BrandProfileInput {
  businessName: string;
  whatYouSell: string;
  audience: string;
  voice?: string;
  region?: string;
  goals?: string;
  creativeLicence?: string; // full | balanced | minimal | strict (undefined = leave unchanged)
  channels?: string; // comma list of planned channels (undefined = leave unchanged)
  siteUrl?: string; // where the brand was inferred from (undefined = leave unchanged)
  // Quiz fields — undefined leaves the stored value unchanged, "" clears it.
  locations?: string;
  serviceAreas?: string;
  phone?: string;
  email?: string;
  address?: string;
  products?: string;
  priceBand?: string;
  offers?: string;
  usps?: string;
  competitors?: string;
  keywords?: string;
  hashtags?: string;
  palette?: string; // JSON array of hex strings
  fonts?: string;
  socialLinks?: string; // JSON object
  seasonality?: string;
}

export const QUIZ_FIELDS = [
  "locations",
  "serviceAreas",
  "phone",
  "email",
  "address",
  "products",
  "priceBand",
  "offers",
  "usps",
  "competitors",
  "keywords",
  "hashtags",
  "palette",
  "fonts",
  "socialLinks",
  "seasonality",
] as const;
type QuizField = (typeof QUIZ_FIELDS)[number];

const QUIZ_MAX: Partial<Record<QuizField, number>> = {
  phone: 60,
  email: 160,
  priceBand: 160,
  fonts: 200,
  hashtags: 400,
  keywords: 600,
  competitors: 600,
  palette: 400,
  socialLinks: 1200,
};

/** The scope's profile, or null when that scope hasn't finished setup. "" is the workspace. */
export async function getBrandProfile(userId: string): Promise<BrandProfile | null> {
  return db.brandProfile.findUnique({ where: { userId } });
}

export async function upsertBrandProfile(userId: string, input: BrandProfileInput): Promise<BrandProfile> {
  const clean = {
    businessName: input.businessName?.trim().slice(0, 120) ?? "",
    whatYouSell: input.whatYouSell?.trim().slice(0, 1000) ?? "",
    audience: input.audience?.trim().slice(0, 600) ?? "",
    voice: input.voice?.trim().slice(0, 400) || null,
    region: input.region?.trim().slice(0, 120) || null,
    goals: input.goals?.trim().slice(0, 600) || null,
  };
  // Fields a caller omits are LEFT UNCHANGED on update (the /brand form and the
  // website-refresh flow never send licence/channels — they must not null the
  // choices made during onboarding). Present keys are validated as before.
  const optional: Partial<Record<"creativeLicence" | "channels" | "siteUrl" | QuizField, string | null>> = {};
  if (input.creativeLicence !== undefined) {
    optional.creativeLicence = ["full", "balanced", "minimal", "strict"].includes(input.creativeLicence)
      ? input.creativeLicence
      : null;
  }
  if (input.channels !== undefined) optional.channels = input.channels.trim().slice(0, 200) || null;
  if (input.siteUrl !== undefined) optional.siteUrl = input.siteUrl.trim().slice(0, 400) || null;
  for (const key of QUIZ_FIELDS) {
    const value = input[key];
    if (value === undefined) continue;
    optional[key] = String(value).trim().slice(0, QUIZ_MAX[key] ?? 1000) || null;
  }
  if (!clean.businessName) throw new Error("Enter your business name.");
  if (!clean.whatYouSell) throw new Error("Describe what you sell or do.");
  if (!clean.audience) throw new Error("Describe who your customers are.");
  return db.brandProfile.upsert({
    where: { userId },
    create: { userId, ...clean, ...optional },
    update: { ...clean, ...optional },
  });
}

/** The brief for a scope, or the neutral note. "" is the workspace. */
export async function brandBriefFor(scopeUserId: string): Promise<string> {
  const p = await getBrandProfile(scopeUserId);
  return p ? renderBrandBrief(p) : NEUTRAL_BRAND_NOTE;
}

/** Short display name for UI chrome (post replicas, headers). */
export async function brandDisplayName(scopeUserId: string): Promise<string> {
  const p = await getBrandProfile(scopeUserId);
  return p?.businessName || "Your brand";
}

/**
 * Task suffix for agent runs: the scope's brand brief (or the neutral note),
 * appended after the task so the brand steers the work. `forceNeutral` is for
 * runs whose whole job is to (re)derive the brand from source material.
 */
export async function brandTaskSuffix(scopeUserId: string, forceNeutral = false): Promise<string> {
  const brief = forceNeutral ? WITHHELD_BRAND_NOTE : await brandBriefFor(scopeUserId);
  return ["", "---", "WHO THIS RUN IS FOR", brief].join("\n");
}
