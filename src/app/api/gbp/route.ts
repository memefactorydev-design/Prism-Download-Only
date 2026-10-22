import { runGbpResearch } from "@/lib/gbp";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { location?: string };
  try {
    const { report, data } = await runGbpResearch(body.location, scopeOf(user));
    return Response.json({ reportId: report.id, data });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
