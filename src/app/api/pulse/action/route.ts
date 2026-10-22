// One-tap Pulse action — creates drafts / plans stubs / shortlists an ad
// idea. Nothing here publishes or spends; the approval gates stay in charge.

import { runPulseAction } from "@/lib/pulse";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { reportId?: string; index?: number };
  if (!body.reportId || body.index === undefined) {
    return Response.json({ error: "reportId and index are required." }, { status: 400 });
  }
  try {
    const message = await runPulseAction(body.reportId, body.index, user, scopeOf(user));
    return Response.json({ ok: true, message });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
