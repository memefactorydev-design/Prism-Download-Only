// Run Studio trend research: scrape a platform for a topic (Apify) → agent →
// stored viral-pattern briefs that feed the reel/montage planners.

import { runTrendResearch } from "@/lib/trends";
import { getSessionUser, scopeOf } from "@/lib/auth";
import type { TrendPlatform } from "@/lib/apify";

export const maxDuration = 300; // scrape + agent are slow

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    platform?: string;
    topic?: string;
    keywords?: string;
  };
  const allowed = ["tiktok", "instagram", "youtube", "linkedin", "pinterest", "facebook"] as const;
  const platform = allowed.find((p) => p === body.platform) ?? null;
  if (!platform) return Response.json({ error: `Pick a platform (${allowed.join(", ")}).` }, { status: 400 });
  if (!body.topic?.trim()) return Response.json({ error: "Enter a topic to research." }, { status: 400 });

  try {
    const result = await runTrendResearch(platform as TrendPlatform, body.topic, body.keywords ?? "", scopeOf(user));
    return Response.json({
      scrapedCount: result.scrapedCount,
      insights: result.insights.map((i) => ({
        id: i.id,
        platform: i.platform,
        topic: i.topic,
        rank: i.rank,
        title: i.title,
        hook: i.hook,
        format: i.format,
        pacing: i.pacing,
        sound: i.sound,
        whyItWorks: i.whyItWorks,
        evidence: i.evidence,
        score: i.score,
      })),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
