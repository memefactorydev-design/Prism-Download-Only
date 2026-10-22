import { runSeoResearch } from "@/lib/seo";
import { getSessionUser, scopeOf } from "@/lib/auth";

// Fetch the live site + scrape SERPs + pull real Search Console data + run
// seo-geo-agent for a structured, actionable audit. Takes a few minutes.
export const maxDuration = 300; // Vercel Pro cap (was 600 — exceeds all plans)

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { focus?: string };
  try {
    const { report, data } = await runSeoResearch(body.focus, scopeOf(user));
    return Response.json({ reportId: report.id, data });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
