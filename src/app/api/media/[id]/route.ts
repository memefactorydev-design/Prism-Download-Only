import { db } from "@/lib/db";
import { removeMedia } from "@/lib/media";
import { canTouch, getSessionUser } from "@/lib/auth";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || !canTouch(asset, user)) return Response.json({ error: "Not found." }, { status: 404 });
  try {
    await removeMedia(id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
