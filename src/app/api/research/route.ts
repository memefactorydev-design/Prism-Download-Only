import { runAdResearch } from "@/lib/research";
import { getSessionUser, scopeOf } from "@/lib/auth";

// Kicks off an ad-research run (Ad Library evidence → ad-research-agent →
// ranked ideas). Synchronous — a run takes on the order of a minute.
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { query?: string };
  try {
    const summary = await runAdResearch(body.query, scopeOf(user));
    return Response.json({ summary });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
