// Widget-open hydration: the member's recent Iris thread + their tickets.

import { db } from "@/lib/db";
import { getSessionUser, scopeOf } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  const [messages, tickets] = await Promise.all([
    db.assistMessage.findMany({ where: { userId: scope }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.supportTicket.findMany({ where: { userId: scope }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return Response.json({
    messages: messages.reverse().map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
    tickets: tickets.map((t) => ({
      id: t.id,
      reference: `#${t.id.slice(-6)}`,
      subject: t.subject,
      status: t.status,
      urgency: t.urgency,
      resolution: t.resolution,
      createdAt: t.createdAt,
    })),
  });
}
