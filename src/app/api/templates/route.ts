// Run template research: scrape a niche's top performers (Apify) →
// template-research-agent → stored CapCut-style blueprints with per-platform
// captions/hashtags. Mirrors /api/studio/trends.

import { runTemplateResearch, type PlatformFocus } from "@/lib/templates";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300; // scrape(s) + agent are slow

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    niche?: string;
    keywords?: string;
    platformFocus?: string;
  };
  if (!body.niche?.trim()) return Response.json({ error: "Enter a niche to research." }, { status: 400 });
  const allowedFocus: PlatformFocus[] = ["both", "all", "tiktok", "instagram", "youtube", "pinterest"];
  const focus: PlatformFocus = allowedFocus.find((f) => f === body.platformFocus) ?? "both";

  try {
    const result = await runTemplateResearch(body.niche, body.keywords ?? "", focus, scopeOf(user));
    return Response.json({ scrapedCount: result.scrapedCount, count: result.templates.length });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
