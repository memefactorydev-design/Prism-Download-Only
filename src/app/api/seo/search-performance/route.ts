// Live Search Console performance for the /seo dashboard panel — real
// queries, clicks and positions for the scope's connected property.

import { fetchSearchPerformance } from "@/lib/gsc";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 60;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    return Response.json(await fetchSearchPerformance(scopeOf(user)));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
