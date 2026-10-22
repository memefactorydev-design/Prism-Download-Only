// Ad research orchestration (Phase 3): gather evidence (Meta Ad Library +
// the brand's own ROAS history), hand it to ad-research-agent, store the ranked
// ideas and the brief. Failed evidence sources are recorded honestly and shown
// to the agent rather than silently dropped.

import type { AdIdea } from "@prisma/client";
import { runAgent } from "@/lib/agents/run-agent";
import { db } from "@/lib/db";
import { searchAdLibrary, type AdLibraryResult } from "@/lib/meta/ad-library";
import { scrapeTrends } from "@/lib/apify";
import { getSecrets } from "@/lib/connections";
import { getBrandProfile } from "@/lib/brand-profile";

/** Ad Library search terms for a scope: its target keywords, else phrases
 *  built from what it sells. Never an industry baked into the code. */
async function defaultSearchesFor(scopeUserId: string): Promise<string[]> {
  const p = await getBrandProfile(scopeUserId);
  const keywords = (p?.keywords ?? "")
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
  if (keywords.length) return keywords.slice(0, 3);
  const what = (p?.whatYouSell ?? "").split(/[.;\n]/)[0].trim();
  if (what) return [what.slice(0, 60), `${what.slice(0, 40)} ${p?.region ?? ""}`.trim()].filter(Boolean);
  return [];
}

// UK first; IE as the EU proxy (full Ad Library API coverage under DSA).
const COUNTRIES = ["GB", "IE"];

interface IdeaPayload {
  rank: number;
  title: string;
  hook: string;
  format: string;
  targetAudience: string;
  evidence: string;
  brandAngle: string;
}

interface ResearchPayload {
  reportMarkdown: string;
  ideas: IdeaPayload[];
  notObtainable: string[];
}

// Structured-output schema (no minLength/maxItems — unsupported constraints).
const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    reportMarkdown: {
      type: "string",
      description:
        "The full research brief as markdown, following the output format in your instructions, including the 'Not reliably obtainable' section.",
    },
    ideas: {
      type: "array",
      description: "Ranked ad ideas, best first.",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          title: { type: "string" },
          hook: { type: "string", description: "The first 2-3 seconds, written out." },
          format: { type: "string" },
          targetAudience: { type: "string" },
          evidence: { type: "string", description: "Which source/pattern supports this." },
          brandAngle: { type: "string" },
        },
        required: ["rank", "title", "hook", "format", "targetAudience", "evidence", "brandAngle"],
        additionalProperties: false,
      },
    },
    notObtainable: {
      type: "array",
      description: "Data points that could not be reliably obtained, and why.",
      items: { type: "string" },
    },
  },
  required: ["reportMarkdown", "ideas", "notObtainable"],
  additionalProperties: false,
};

export interface ResearchRunSummary {
  reportId: string;
  ideas: AdIdea[];
  notObtainable: string[];
  evidenceNotes: string[];
}

export async function runAdResearch(query?: string, scopeUserId = ""): Promise<ResearchRunSummary> {
  const defaults = await defaultSearchesFor(scopeUserId);
  const searches = query?.trim() ? [query.trim(), ...defaults.slice(0, 1)] : defaults;
  if (!searches.length) {
    throw new Error("Give the research a focus, or add target keywords (or what you sell) to your brand on /brand first.");
  }

  // 1. Evidence: Ad Library searches. The official API needs a special
  // verified access most accounts don't have (and outside the EU it mostly
  // covers political ads) — so when it refuses, we read the PUBLIC Ad Library
  // through the research engine instead. Each failure is recorded, not fatal.
  const evidence: { term: string; ads: AdLibraryResult[] }[] = [];
  const evidenceNotes: string[] = [];
  const radarAvailable = Boolean(await getSecrets("apify"));
  for (const term of searches) {
    try {
      const ads = await searchAdLibrary({ searchTerms: term, countries: COUNTRIES, limit: 25 });
      evidence.push({ term, ads });
      evidenceNotes.push(`"${term}": ${ads.length} active ads found (${COUNTRIES.join(", ")}, official archive).`);
      continue;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!radarAvailable) {
        evidenceNotes.push(`"${term}": FAILED — ${reason}`);
        continue;
      }
      try {
        const items = await scrapeTrends("facebook", term, "", 25);
        const ads: AdLibraryResult[] = items.map((it, i) => ({
          id: `radar-${i}`,
          pageName: it.author ?? "",
          adCreativeBodies: it.caption ? [it.caption] : [],
          adCreativeLinkTitles: [],
          adDeliveryStartTime: "",
          publisherPlatforms: ["facebook"],
          adSnapshotUrl: it.url ?? "",
        }));
        evidence.push({ term, ads });
        evidenceNotes.push(`"${term}": ${ads.length} active ads read from the public Ad Library.`);
      } catch (fallbackErr) {
        evidenceNotes.push(
          `"${term}": FAILED — ${reason}; public Ad Library read also failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
        );
      }
    }
  }
  if (evidence.length === 0) {
    throw new Error(
      radarAvailable
        ? `The Ad Library couldn't be read right now. ${evidenceNotes.join(" | ")}`
        : "The official ad archive refused access and Prism Radar isn't connected — connect it on the Connections page so research can read the public Ad Library instead."
    );
  }

  // 2. Evidence: this scope's own ROAS history — never another scope's accounts.
  const roas = await db.roasSnapshot.findMany({ where: { userId: scopeUserId }, orderBy: { date: "desc" }, take: 90 });
  const profile = await getBrandProfile(scopeUserId);
  const channels = profile?.channels?.split(",").map((c) => c.trim()).filter(Boolean).join(", ") || "Instagram, Facebook, TikTok, LinkedIn and YouTube";

  // 3. Hand everything to the agent.
  const task = [
    query?.trim()
      ? `Research focus requested by the owner: "${query.trim()}".`
      : "Produce this period's ad research brief.",
    "",
    "## Evidence gathered by the backend",
    "",
    "### Meta Ad Library search log",
    ...evidenceNotes.map((n) => `- ${n}`),
    "",
    "### Active ads found (Ad Library)",
    "```json",
    JSON.stringify(
      evidence.map((e) => ({
        searchTerm: e.term,
        ads: e.ads.map((a) => ({
          pageName: a.pageName,
          creativeBodies: a.adCreativeBodies.slice(0, 2),
          linkTitles: a.adCreativeLinkTitles.slice(0, 2),
          runningSince: a.adDeliveryStartTime,
          platforms: a.publisherPlatforms,
          snapshotUrl: a.adSnapshotUrl,
        })),
      })),
      null,
      2
    ).slice(0, 60_000),
    "```",
    "",
    "### The brand's own ROAS history",
    roas.length === 0
      ? "No ROAS data yet — Meta ads reading starts in Phase 4. Note this honestly in the brief."
      : "```json\n" + JSON.stringify(roas, null, 2) + "\n```",
    "",
    `The brand publishes to ${channels} — tailor ideas across these channels and name the best-fit platform(s) in each idea's target audience, including YouTube (Shorts for vertical, in-stream for longer) where it fits.`,
    "Produce 5-8 ranked ad ideas. Long-running ads (early runningSince dates, still active) are a strong signal the creative is working — weight them accordingly; where runningSince is blank the ads are still confirmed ACTIVE, just undated. Include failed searches and missing data in notObtainable.",
  ].join("\n");

  const { report, data } = await runAgent<ResearchPayload>("ad-research-agent", task, {
    schema: RESEARCH_SCHEMA,
    reportKind: "research_brief",
    reportTitle: query?.trim() ? `Ad research: ${query.trim()}` : "Ad research brief",
    scopeUserId,
  });
  if (!data) throw new Error("ad-research-agent returned no structured data.");

  // 4. Persist: archive the previous batch's untouched ideas (this scope only),
  //    insert the new ones into the requester's scope.
  await db.adIdea.updateMany({ where: { status: "new", userId: scopeUserId }, data: { status: "archived" } });
  const ideas: AdIdea[] = [];
  for (const idea of data.ideas) {
    ideas.push(
      await db.adIdea.create({
        data: {
          userId: scopeUserId,
          rank: idea.rank,
          title: idea.title,
          hook: idea.hook,
          format: idea.format,
          targetAudience: idea.targetAudience,
          evidence: idea.evidence,
          brandAngle: idea.brandAngle,
        },
      })
    );
  }

  return { reportId: report.id, ideas, notObtainable: data.notObtainable, evidenceNotes };
}
