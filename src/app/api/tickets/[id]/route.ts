// Admin: resolve a ticket (with an optional note the member sees in Iris).

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { track } from "@/lib/events";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate) return gate;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: string; note?: string };
  if (body.action !== "resolve") return Response.json({ error: "Unknown action." }, { status: 400 });
  const ticket = await db.supportTicket.findUnique({ where: { id } });
  if (!ticket) return Response.json({ error: "Ticket not found." }, { status: 404 });
  const updated = await db.supportTicket.update({
    where: { id },
    data: { status: "resolved", resolution: (body.note ?? "").trim().slice(0, 1000) || null },
  });
  track("ticket_resolved", ticket.userId, { urgency: ticket.urgency });
  return Response.json({ ok: true, status: updated.status });
}
