// The brand brief: a BrandProfile row rendered into the markdown block every
// agent prompt reads. Pure (no database) so it can be unit-tested; the scoped
// helpers live in brand-profile.ts.

import type { BrandProfile } from "@prisma/client";

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return value
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : {};
  } catch {
    return {};
  }
}

export function licenceLine(licence: string | null | undefined): string {
  switch (licence) {
    case "full":
      return "FULL FREEDOM — take bold creative swings and novel angles; surprise them.";
    case "minimal":
      return "KEEP IT CLOSE — stay near their established content; novelty in small doses.";
    case "strict":
      return "STRICT — only their established voice, formats and claims; no experiments.";
    default:
      return "BALANCED — fresh ideas inside the brand's lane.";
  }
}

/** The section headings are a CONTRACT with the prompt files (agents/BRAND.md lists them). */
export const BRIEF_SECTIONS = [
  "Overview",
  "Audience",
  "Positioning & USPs",
  "Voice & tone",
  "Locations & service areas",
  "Goals",
  "Channels",
  "Competitors (know them; never disparage by name)",
  "Search & social",
  "Visual identity",
  "Seasonality",
  "Creative licence",
] as const;

/**
 * The brand brief in markdown. Empty sections are omitted so a thin profile
 * stays honest rather than padded; the model is told unlisted facts are unknown.
 */
export function renderBrandBrief(p: BrandProfile): string {
  const bullet = (label: string, value: string | null | undefined) => (value?.trim() ? `- **${label}:** ${value.trim()}` : "");
  const section = (title: (typeof BRIEF_SECTIONS)[number], lines: string[]) => {
    const kept = lines.filter(Boolean);
    return kept.length ? [`## ${title}`, ...kept].join("\n") : "";
  };
  const social = Object.entries(parseJsonObject(p.socialLinks));
  const palette = parseJsonArray(p.palette);
  const contact = [p.phone, p.email, p.address].filter((v) => v?.trim()).join(" · ");
  const channels = p.channels
    ?.split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .join(", ");

  return [
    `# Brand brief — ${p.businessName}`,
    "This is the business every agent works for. Everything you research, write, plan or design must fit it. Facts not listed here are unknown — never invent them.",
    section("Overview", [
      bullet("Business", `${p.businessName}${p.siteUrl ? ` (${p.siteUrl})` : ""}`),
      bullet("What they sell / do", p.whatYouSell),
      bullet("Products & services", p.products),
      bullet("Price band", p.priceBand),
    ]),
    section("Audience", [bullet("Who buys", p.audience)]),
    section("Positioning & USPs", [
      bullet("What sets them apart", p.usps),
      bullet("Current offers (verify before use; never invent new ones)", p.offers),
    ]),
    section("Voice & tone", [bullet("Voice", p.voice)]),
    section("Locations & service areas", [
      bullet("Locations", p.locations),
      bullet("Service areas", p.serviceAreas),
      bullet("Region", p.region),
      bullet("Contact", contact),
    ]),
    section("Goals", [bullet("What the marketing must achieve", p.goals)]),
    section("Channels", [bullet("Where they publish", channels)]),
    section("Competitors (know them; never disparage by name)", [bullet("Named competitors", p.competitors)]),
    section("Search & social", [
      bullet("Target keywords", p.keywords),
      bullet("Brand hashtags", p.hashtags),
      social.length ? `- **Social profiles:** ${social.map(([k, v]) => `${k}: ${v}`).join(" · ")}` : "",
    ]),
    section("Visual identity", [palette.length ? `- **Palette:** ${palette.join(", ")}` : "", bullet("Type", p.fonts)]),
    section("Seasonality", [bullet("Key moments", p.seasonality)]),
    section("Creative licence", [`- ${licenceLine(p.creativeLicence)}`]),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What agents get when a scope has no brand yet. */
export const NEUTRAL_BRAND_NOTE = [
  "# Brand brief — not set up yet",
  "No brand has been configured for this workspace. Work brand-neutrally from the task itself: do not assume an industry, location, audience or offer; never invent business facts; and where it helps, remind the user to finish setup at /welcome (or /brand) so the team can tailor everything to their business.",
].join("\n");

/** For runs whose whole job is to derive the brand from source material. */
export const WITHHELD_BRAND_NOTE = [
  "# Brand brief — intentionally withheld",
  "This run must read the source material it was given and derive facts from THAT. Do not assume any existing brand, industry or audience.",
].join("\n");
