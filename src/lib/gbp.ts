// Google Business Profile optimiser: scrape the local pack + competitors
// (Google Maps/SERP via Apify), then gbp-agent returns a concrete optimisation
// plan + ready-to-post weekly posts. Draft & copy now; postToGbp() is the seam
// for the live Google Business Profile API later.

import type { AgentReport } from "@prisma/client";
import { runAgent } from "@/lib/agents/run-agent";
import { googleMaps, googleSearch } from "@/lib/serp";
import { getBrandProfile } from "@/lib/brand-profile";

const GBP_SCHEMA = {
  type: "object",
  properties: {
    reportMarkdown: { type: "string" },
    snapshot: { type: "string" },
    primaryCategory: { type: "string" },
    secondaryCategories: { type: "array", items: { type: "string" } },
    services: { type: "array", items: { type: "string" } },
    attributes: { type: "array", items: { type: "string" } },
    description: { type: "string", description: "Ready-to-paste GBP description (<=750 chars)." },
    localKeywords: { type: "array", items: { type: "string" } },
    reviewStrategy: { type: "string" },
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" }, cta: { type: "string" } },
        required: ["title", "body", "cta"],
        additionalProperties: false,
      },
    },
    photoPlan: { type: "array", items: { type: "string" } },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: [
    "reportMarkdown", "snapshot", "primaryCategory", "secondaryCategories", "services", "attributes",
    "description", "localKeywords", "reviewStrategy", "posts", "photoPlan", "caveats",
  ],
  additionalProperties: false,
};

export interface GbpData {
  reportMarkdown: string;
  snapshot: string;
  primaryCategory: string;
  secondaryCategories: string[];
  services: string[];
  attributes: string[];
  description: string;
  localKeywords: string[];
  reviewStrategy: string;
  posts: { title: string; body: string; cta: string }[];
  photoPlan: string[];
  caveats: string[];
}

export async function runGbpResearch(location?: string, scopeUserId = ""): Promise<{ report: AgentReport; data: GbpData }> {
  const profile = await getBrandProfile(scopeUserId);
  if (!profile) {
    throw new Error("Set up your brand first (/welcome or /brand) so the research knows which business and category to look at.");
  }
  const business = profile.businessName;
  // The local category is what the business sells, in the words a customer would search.
  const category = (profile.keywords?.split(/[,\n]/)[0] ?? "").trim() || profile.whatYouSell.split(/[.;\n]/)[0].trim().slice(0, 50);
  const firstArea = (profile.serviceAreas ?? profile.region ?? "").split(/[,\n]/)[0].trim();
  const city = location?.trim() || firstArea || "your area";
  const locationQuery = location?.trim() || firstArea || profile.region || "";
  const competitorQuery = `${category} ${city}`.trim();
  // Maps searches use compass/crawler-google-places with a locationQuery for
  // accurate local targeting; SERP stays a plain query.
  const [own, competitors, serp] = await Promise.all([
    googleMaps(business, 3, locationQuery),
    googleMaps(category, 10, locationQuery),
    googleSearch(competitorQuery, 6),
  ]);

  const evidence = {
    ownListing: own.items,
    competitors: competitors.items,
    serp: serp.items,
    notes: [own.error, competitors.error, serp.error].filter(Boolean),
  };

  const task = [
    `Optimise ${business}'s Google Business Profile for "${city}".`,
    "Compare against the top local competitors below and produce a concrete plan + this week's posts.",
    "",
    "## Scraped Google Maps + SERP evidence",
    evidence.competitors.length || evidence.ownListing.length
      ? "```json\n" + JSON.stringify(evidence, null, 2).slice(0, 30_000) + "\n```"
      : "No Maps/SERP scrape available (note in caveats and base the plan on best practice for this category and area).",
    "",
    "Return the structured object with ready-to-paste categories, services, description, local keywords, review strategy, weekly posts and a photo plan.",
  ].join("\n");

  const { report, data } = await runAgent<GbpData>("gbp-agent", task, {
    schema: GBP_SCHEMA,
    maxTokens: 16000,
    reportKind: scopeUserId ? `gbp_research:${scopeUserId}` : "gbp_research",
    reportTitle: `GBP optimisation: ${city}`,
    scopeUserId,
  });
  if (!data) throw new Error("gbp-agent returned no plan.");
  return { report, data };
}

/** Seam for the live Google Business Profile API (OAuth + GBP API) — not wired yet. */
export async function postToGbp(): Promise<never> {
  throw new Error(
    "Posting to Google Business Profile isn't connected yet. For now, copy the generated posts into your GBP dashboard. Live auto-posting arrives once the Google Business Profile API is connected."
  );
}
