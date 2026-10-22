import { getSessionUser, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard) return guard;
  const { id } = await params;
  const me = await getSessionUser();
  if (me?.id === id) return Response.json({ error: "You can't delete your own account." }, { status: 400 });
  const target = await db.user.findUnique({ where: { id } });
  if (!target) return Response.json({ error: "User not found." }, { status: 404 });
  if (target.role === "admin") {
    const admins = await db.user.count({ where: { role: "admin" } });
    if (admins <= 1) return Response.json({ error: "There must be at least one admin." }, { status: 400 });
  }
  // Remove the account plus its per-user credentials and brand profile. The
  // user's sandboxed CONTENT (posts, media, research…) stays for now — the
  // admin can still see and tidy it; full data erasure is a separate, explicit
  // GDPR flow.
  await db.connection.deleteMany({ where: { userId: id } });
  await db.brandProfile.deleteMany({ where: { userId: id } });
  await db.user.delete({ where: { id } });
  return Response.json({ ok: true });
}
