// Templates research: scrape a niche's top performers (Apify) across TikTok/
// Instagram, hand the metadata to template-research-agent, and store ranked
// CapCut-style template blueprints (ContentTemplate) with ready-to-use captions
// and hashtags per platform. Mirrors src/lib/trends.ts.
// Patterns/metadata only — never other creators' video files.

import type { ContentTemplate } from "@prisma/client";
import { runAgent } from "@/lib/agents/run-agent";
import { db } from "@/lib/db";
import { scrapeTrends, type TrendPlatform } from "@/lib/apify";

export type PlatformFocus = "both" | "all" | "tiktok" | "instagram" | "youtube" | "pinterest";

// Ready-to-use copy for each posting platform. All keys required (structured
// outputs don't support optional-with-default; empty strings are fine).
// "gbp" is a Google Business Profile post adaptation of the template's story.
const PLATFORM_COPY_SCHEMA = {
  type: "object",
  properties: {
    instagram: { type: "string" },
    tiktok: { type: "string" },
    facebook: { type: "string" },
    youtube: { type: "string" },
    linkedin: { type: "string" },
    pinterest: { type: "string" },
    gbp: { type: "string" },
  },
  required: ["instagram", "tiktok", "facebook", "youtube", "linkedin", "pinterest", "gbp"],
  additionalProperties: false,
} as const;

// No minItems/maxLength — unsupported constraints (see src/lib/research.ts).
const TEMPLATE_SCHEMA = {
  type: "object",
  properties: {
    reportMarkdown: {
      type: "string",
      description: "Short overview of the templates found and how the brand should use them.",
    },
    templates: {
      type: "array",
      description: "Ranked content-template blueprints, strongest first (~5).",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          title: { type: "string" },
          format: { type: "string", description: "Intended format: reel | post | carousel | short | video." },
          blueprint: {
            type: "string",
            description: "Step-by-step CapCut-style editing recipe: segments/beats, on-screen text, transitions, timing, music vibe.",
          },
          hook: { type: "string", description: "The opening 2-3s pattern, written out." },
          whyItWorks: { type: "string" },
          captions: { ...PLATFORM_COPY_SCHEMA, description: "Ready-to-post caption per platform (youtube = description)." },
          hashtags: { ...PLATFORM_COPY_SCHEMA, description: "Hashtags per platform (youtube = tags)." },
          youtubeTitle: { type: "string", description: "Click-worthy YouTube title, <= 80 chars." },
          evidence: { type: "string", description: "A public URL/handle from the data." },
          score: { type: "integer", description: "0-100 strength/relevance to the brand in the brief." },
        },
        required: [
          "rank", "title", "format", "blueprint", "hook", "whyItWorks",
          "captions", "hashtags", "youtubeTitle", "evidence", "score",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["reportMarkdown", "templates"],
  additionalProperties: false,
};

interface PlatformCopy {
  instagram: string;
  tiktok: string;
  facebook: string;
  youtube: string;
  linkedin: string;
}

interface TemplatePayload {
  reportMarkdown: string;
  templates: {
    rank: number;
    title: string;
    format: string;
    blueprint: string;
    hook: string;
    whyItWorks: string;
    captions: PlatformCopy;
    hashtags: PlatformCopy;
    youtubeTitle: string;
    evidence: string;
    score: number;
  }[];
}

export interface TemplateRunSummary {
  reportId: string;
  templates: ContentTemplate[];
  scrapedCount: number;
}

function platformsFor(focus: PlatformFocus): TrendPlatform[] {
  if (focus === "tiktok") return ["tiktok"];
  if (focus === "instagram") return ["instagram"];
  if (focus === "youtube") return ["youtube"];
  if (focus === "pinterest") return ["pinterest"];
  if (focus === "all") return ["tiktok", "instagram", "youtube", "pinterest"];
  return ["tiktok", "instagram"];
}

export async function runTemplateResearch(
  niche: string,
  keywords: string,
  focus: PlatformFocus = "both",
  scopeUserId = "" // "" = workspace research; else the requesting member's sandbox
): Promise<TemplateRunSummary> {
  if (!niche.trim()) throw new Error("Enter a niche to research.");

  // 1. Scrape top performers per platform. Each failure is recorded, not fatal —
  //    unless every platform fails (throws a readable error, e.g. Apify not set up).
  const evidence: { platform: TrendPlatform; caption?: string; hashtags?: string[]; sound?: string; author?: string; url?: string; plays?: number; likes?: number; comments?: number; shares?: number }[] = [];
  const scrapeNotes: string[] = [];
  let scrapedCount = 0;
  let lastError: Error | null = null;
  for (const platform of platformsFor(focus)) {
    try {
      const items = await scrapeTrends(platform, niche.trim(), keywords, 12);
      scrapedCount += items.length;
      scrapeNotes.push(`${platform}: ${items.length} top performers scraped.`);
      for (const i of items) {
        evidence.push({
          platform,
          caption: i.caption?.slice(0, 300),
          hashtags: i.hashtags?.slice(0, 12),
          sound: i.sound,
          author: i.author,
          url: i.url,
          plays: i.playCount,
          likes: i.likeCount,
          comments: i.commentCount,
          shares: i.shareCount,
        });
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      scrapeNotes.push(`${platform}: FAILED — ${lastError.message}`);
    }
  }
  if (evidence.length === 0) {
    throw new Error(lastError?.message ?? "No template data could be scraped — try a different niche or keywords.");
  }

  // 2. Hand the metadata to the agent.
  const task = [
    `Research viral short-form templates for the niche "${niche.trim()}"${keywords.trim() ? ` (keywords: ${keywords.trim()})` : ""}.`,
    `Stay strictly on THIS niche ("${niche.trim()}"). Distil ranked, reproducible CapCut-style template blueprints the brand can rebuild with its own footage for this niche, each with ready-to-post captions and hashtags for Instagram, TikTok, Facebook, YouTube, LinkedIn, Pinterest and Google Business (plus a YouTube title). Never default to the brand's own industry unless the niche is actually about it.`,
    "",
    "## Scrape log",
    ...scrapeNotes.map((n) => `- ${n}`),
    "",
    "## Scraped top performers (public metadata only)",
    "```json",
    JSON.stringify(evidence, null, 2).slice(0, 55_000),
    "```",
    "",
    "Weight patterns that recur across the highest-engagement items. Produce about 5 strong templates. Be honest about thin data.",
  ].join("\n");

  const { report, data } = await runAgent<TemplatePayload>("template-research-agent", task, {
    schema: TEMPLATE_SCHEMA,
    maxTokens: 32000,
    reportKind: "template_research",
    reportTitle: `Templates: ${niche.trim()}`,
    scopeUserId,
  });
  if (!data) throw new Error("template-research-agent returned no structured templates.");

  // 3. Persist ranked templates (archive the previous untouched batch first —
  //    within this scope only; other users' batches are untouched).
  await db.contentTemplate.updateMany({ where: { status: "new", userId: scopeUserId }, data: { status: "archived" } });
  const templates: ContentTemplate[] = [];
  for (const t of data.templates) {
    templates.push(
      await db.contentTemplate.create({
        data: {
          userId: scopeUserId,
          niche: niche.trim(),
          rank: t.rank,
          title: t.title,
          format: normaliseFormat(t.format),
          blueprint: t.blueprint,
          hook: t.hook,
          whyItWorks: t.whyItWorks || null,
          captions: JSON.stringify(t.captions),
          hashtags: JSON.stringify(t.hashtags),
          youtubeTitle: t.youtubeTitle || null,
          evidence: t.evidence || null,
          score: t.score ?? null,
        },
      })
    );
  }
  return { reportId: report.id, templates, scrapedCount };
}

const KNOWN_FORMATS = new Set(["reel", "post", "carousel", "short", "video", "story"]);
function normaliseFormat(raw: string): string {
  const f = raw.trim().toLowerCase();
  return KNOWN_FORMATS.has(f) ? f : "reel";
}

/** Recent templates, newest first — used for the Templates page display list. */
export async function recentTemplates(
  actor?: { id: string; role: string },
  limit = 30
): Promise<ContentTemplate[]> {
  return db.contentTemplate.findMany({
    where: {
      status: { not: "archived" },
      ...(actor && actor.role !== "admin" ? { userId: actor.id } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { rank: "asc" }],
    take: limit,
  });
}
