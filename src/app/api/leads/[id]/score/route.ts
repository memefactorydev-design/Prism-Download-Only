// AI deep-score for one lead (lead-scorer-agent): quality 0-100, an actionable
// reason, and the recommended next step.

import { db } from "@/lib/db";
import { agentScoreLead } from "@/lib/leads";
import { canTouch, getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 120;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const existing = await db.lead.findUnique({ where: { id } });
  if (!existing || !canTouch(existing, user)) return Response.json({ error: "Lead not found." }, { status: 404 });
  try {
    return Response.json({ lead: await agentScoreLead(id, scopeOf(user)) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
