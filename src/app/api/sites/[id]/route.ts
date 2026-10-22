import { db } from "@/lib/db";
import { canTouch, getSessionUser } from "@/lib/auth";

// Rename a site.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const existing = await db.site.findUnique({ where: { id } });
  if (!existing || !canTouch(existing, user)) return Response.json({ error: "Site not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  if (!body.name?.trim()) return Response.json({ error: "Name required." }, { status: 400 });
  const site = await db.site.update({ where: { id }, data: { name: body.name.trim() } });
  return Response.json({ id: site.id });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const existing = await db.site.findUnique({ where: { id } });
  if (existing && canTouch(existing, user)) {
    await db.site.delete({ where: { id } });
  }
  return Response.json({ ok: true });
}
