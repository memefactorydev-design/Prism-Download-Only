// Restore a previous plan (from a revision or an assistant message snapshot)
// into the project's working plan — the Director's undo.

import { db } from "@/lib/db";
import { canTouch, getSessionUser } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const owning = await db.fableProject.findUnique({ where: { id } });
  if (!owning || !canTouch(owning, user)) return Response.json({ error: "Project not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { revisionId?: string; messageId?: string };

  let plan: string | null = null;
  let label = "";
  if (body.revisionId) {
    const rev = await db.fableRevision.findUnique({ where: { id: body.revisionId } });
    if (!rev || rev.projectId !== id) return Response.json({ error: "Revision not found." }, { status: 404 });
    plan = rev.plan;
    label = `revision ${rev.number}`;
  } else if (body.messageId) {
    const message = await db.fableMessage.findUnique({ where: { id: body.messageId } });
    if (!message || message.projectId !== id || !message.planSnapshot) {
      return Response.json({ error: "That message has no plan to restore." }, { status: 404 });
    }
    plan = message.planSnapshot;
    label = "an earlier plan";
  } else {
    return Response.json({ error: "Pass revisionId or messageId." }, { status: 400 });
  }

  await db.fableProject.update({
    where: { id },
    data: { plan, planVersion: { increment: 1 } },
  });
  await db.fableMessage.create({
    data: { projectId: id, role: "assistant", content: `↩️ Restored ${label}.` },
  });
  return Response.json({ ok: true, plan: JSON.parse(plan) });
}
