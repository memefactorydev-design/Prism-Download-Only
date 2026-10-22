import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  // Scope-checked delete: members remove only deals in their own ledger.
  const scope = user.role === "admin" ? "" : user.id;
  await db.deal.deleteMany({ where: { id, userId: scope } });
  return Response.json({ ok: true });
}
