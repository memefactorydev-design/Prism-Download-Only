// Admin: the support ticket queue Iris feeds.

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const gate = await requireAdmin();
  if (gate) return gate;
  const tickets = await db.supportTicket.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }], // "open" < "resolved"
    take: 200,
  });
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(tickets.map((t) => t.userId).filter(Boolean))] } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return Response.json({
    tickets: tickets.map((t) => ({
      id: t.id,
      reference: `#${t.id.slice(-6)}`,
      member: byId.get(t.userId)?.name || byId.get(t.userId)?.email || "workspace",
      subject: t.subject,
      summary: t.summary,
      urgency: t.urgency,
      status: t.status,
      resolution: t.resolution,
      transcript: t.transcript,
      createdAt: t.createdAt,
    })),
  });
}
