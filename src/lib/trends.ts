// Studio trend research: scrape a platform's top performers for a topic (Apify),
// hand the metadata to the platform's trend agent, and store ranked viral-pattern
// briefs (TrendInsight). Mirrors the Ad Library flow in src/lib/research.ts.
// Patterns/metadata only — never other creators' video files.

import type { TrendInsight } from "@prisma/client";
import { runAgent, type AgentName } from "@/lib/agents/run-agent";
import { db } from "@/lib/db";
import { scrapeTrends, type TrendPlatform } from "@/lib/apify";

const AGENT_BY_PLATFORM: Record<TrendPlatform, AgentName> = {
  tiktok: "tiktok-trend-agent",
  instagram: "instagram-trend-agent",
  youtube: "youtube-trend-agent",
  linkedin: "linkedin-trend-agent",
  pinterest: "pinterest-trend-agent",
  facebook: "facebook-trend-agent", // Ad Library angle — longevity = working spend
};

const PLATFORM_LABELS: Record<TrendPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  facebook: "Facebook (ads)",
};

// No minItems/maxLength — unsupported constraints (see src/lib/research.ts).
const TREND_SCHEMA = {
  type: "object",
  properties: {
    reportMarkdown: { type: "string", description: "Short overview of the trends found and how the brand should use them." },
    insights: {
      type: "array",
      description: "Ranked viral-pattern briefs, strongest first.",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          title: { type: "string" },
          hook: { type: "string", description: "The opening 2-3s pattern, written out." },
          format: { type: "string" },
          pacing: { type: "string", description: "Cut rhythm / clip length guidance." },
          sound: { type: "string", description: "Trending sound/style, or empty." },
          whyItWorks: { type: "string" },
          evidence: { type: "string", description: "A public URL/handle from the data." },
          score: { type: "integer", description: "0-100 strength/relevance to the brand in the brief." },
        },
        required: ["rank", "title", "hook", "format", "pacing", "sound", "whyItWorks", "evidence", "score"],
        additionalProperties: false,
      },
    },
  },
  required: ["reportMarkdown", "insights"],
  additionalProperties: false,
};

interface TrendPayload {
  reportMarkdown: string;
  insights: {
    rank: number;
    title: string;
    hook: string;
    format: string;
    pacing: string;
    sound: string;
    whyItWorks: string;
    evidence: string;
    score: number;
  }[];
}

export interface TrendRunSummary {
  reportId: string;
  insights: TrendInsight[];
  scrapedCount: number;
}

export async function runTrendResearch(
  platform: TrendPlatform,
  topic: string,
  keywords: string,
  scopeUserId = "" // "" = workspace research; else the requesting member's sandbox
): Promise<TrendRunSummary> {
  if (!topic.trim()) throw new Error("Enter a topic to research.");

  // 1. Scrape (throws a readable error if Apify isn't connected / actor fails).
  const items = await scrapeTrends(platform, topic.trim(), keywords, 20);

  // 2. Compact evidence for the agent (metadata only).
  const evidence = items.map((i) => ({
    caption: i.caption?.slice(0, 300),
    hashtags: i.hashtags?.slice(0, 12),
    sound: i.sound,
    author: i.author,
    url: i.url,
    plays: i.playCount,
    likes: i.likeCount,
    comments: i.commentCount,
    shares: i.shareCount,
  }));

  const task = [
    `Analyse the top-performing ${platform} content for the topic "${topic.trim()}"${keywords.trim() ? ` (keywords: ${keywords.trim()})` : ""}.`,
    `Stay focused on THIS topic ("${topic.trim()}"). Distil ranked viral-pattern briefs the brand can apply to its own content production for this niche — never force the brand's own industry onto the topic unless the topic is actually about it.`,
    "",
    "## Scraped top performers (public metadata only)",
    "```json",
    JSON.stringify(evidence, null, 2).slice(0, 60_000),
    "```",
    "",
    "Weight patterns that recur across the highest-engagement items. Be honest about thin data.",
  ].join("\n");

  const agentName = AGENT_BY_PLATFORM[platform] ?? "instagram-trend-agent";
  const platformLabel = PLATFORM_LABELS[platform] ?? platform;
  const { report, data } = await runAgent<TrendPayload>(agentName, task, {
    schema: TREND_SCHEMA,
    maxTokens: 16000,
    reportKind: "trend_research",
    reportTitle: `${platformLabel} trends: ${topic.trim()}`,
    scopeUserId,
  });
  if (!data) throw new Error(`${agentName} returned no structured insights.`);

  // 3. Persist ranked insights.
  const insights: TrendInsight[] = [];
  for (const it of data.insights) {
    insights.push(
      await db.trendInsight.create({
        data: {
          userId: scopeUserId,
          platform,
          topic: topic.trim(),
          rank: it.rank,
          title: it.title,
          hook: it.hook,
          format: it.format,
          pacing: it.pacing || null,
          sound: it.sound || null,
          whyItWorks: it.whyItWorks || null,
          evidence: it.evidence || null,
          score: it.score ?? null,
        },
      })
    );
  }
  return { reportId: report.id, insights, scrapedCount: items.length };
}

/** Recent insights, newest first — used for the Studio page's display list. */
export async function recentTrendInsights(
  actor?: { id: string; role: string },
  limit = 12
): Promise<TrendInsight[]> {
  return db.trendInsight.findMany({
    where: actor && actor.role !== "admin" ? { userId: actor.id } : undefined,
    orderBy: [{ createdAt: "desc" }, { rank: "asc" }],
    take: limit,
  });
}

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "your", "you", "are", "was", "will", "from", "have",
  "has", "not", "but", "they", "their", "our", "out", "into", "over", "when", "what", "how", "why",
  "just", "like", "about", "there", "here", "them", "then", "than", "were", "been", "would", "could",
]);

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []) if (!STOP.has(w)) out.add(w);
  return out;
}

/**
 * Trend insights relevant to a given video's content (topic-matched), fed into the
 * reel/montage planners. Scores recent insights by keyword overlap between the
 * video's text and each insight's topic/title/hook; falls back to recency when
 * nothing overlaps (or there's no text), so it never regresses.
 */
export async function relevantTrendInsights(text: string, limit = 8, scopeUserId = ""): Promise<TrendInsight[]> {
  // Pool is the SCOPE's insights only — a member's planner sees their research.
  const pool = await db.trendInsight.findMany({
    where: { userId: scopeUserId },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  if (!pool.length) return [];
  const vid = tokenize(text);
  if (!vid.size) return pool.slice(0, limit);

  const scored = pool.map((i) => {
    let overlap = 0;
    for (const w of tokenize(`${i.topic} ${i.title} ${i.hook}`)) if (vid.has(w)) overlap++;
    return { i, overlap };
  });
  const matched = scored.filter((s) => s.overlap > 0).sort((a, b) => b.overlap - a.overlap);
  return (matched.length ? matched.map((s) => s.i) : pool).slice(0, limit);
}
