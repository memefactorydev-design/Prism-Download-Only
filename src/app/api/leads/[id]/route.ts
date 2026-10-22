// One lead: edit fields / move status (kanban) / delete.

import { db } from "@/lib/db";
import { LEAD_STATUSES, updateLeadStatus } from "@/lib/leads";
import { canTouch, getSessionUser, scopeOf } from "@/lib/auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { status?: string; name?: string; email?: string; phone?: string; company?: string; detail?: string; subscribed?: boolean }
    | null;
  if (!body) return Response.json({ error: "Missing request body." }, { status: 400 });

  try {
    if (body.status !== undefined) {
      if (!(LEAD_STATUSES as readonly string[]).includes(body.status)) {
        return Response.json({ error: `Status must be one of: ${LEAD_STATUSES.join(", ")}` }, { status: 400 });
      }
      const lead = await updateLeadStatus(id, body.status, scopeOf(user), user.role === "admin");
      return Response.json({ lead });
    }
    const existing = await db.lead.findUnique({ where: { id } });
    if (!existing || !canTouch(existing, user)) return Response.json({ error: "Lead not found." }, { status: 404 });
    const lead = await db.lead.update({
      where: { id },
      data: {
        name: body.name?.trim() || undefined,
        email: body.email === undefined ? undefined : body.email.trim().toLowerCase() || null,
        phone: body.phone === undefined ? undefined : body.phone.trim() || null,
        company: body.company === undefined ? undefined : body.company.trim() || null,
        detail: body.detail === undefined ? undefined : body.detail.trim() || null,
        subscribed: body.subscribed,
      },
    });
    return Response.json({ lead });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const existing = await db.lead.findUnique({ where: { id } });
  if (existing && canTouch(existing, user)) {
    await db.lead.delete({ where: { id } });
  }
  return Response.json({ ok: true });
}
