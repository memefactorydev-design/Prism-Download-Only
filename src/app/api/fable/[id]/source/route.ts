// Add a PHOTO source to an existing Director project — the "conjure an image
// inline" flow. Images need no probe/transcribe, so the source is ready the
// moment it's attached (the animate pipeline turns it into footage at render).
// Videos still go through project creation (they need the prep pass).

import { db } from "@/lib/db";
import { canTouch, getSessionUser } from "@/lib/auth";
import { PHOTO_ANIMATE_MS } from "@/lib/video/transitions";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { assetId?: string };
  if (!body.assetId) return Response.json({ error: "assetId is required" }, { status: 400 });

  const project = await db.fableProject.findUnique({ where: { id }, include: { sources: true } });
  if (!project || !canTouch(project, user)) return Response.json({ error: "Project not found." }, { status: 404 });
  if (project.sources.length >= 8) return Response.json({ error: "This project already has 8 sources." }, { status: 400 });

  const asset = await db.mediaAsset.findUnique({ where: { id: body.assetId } });
  if (!asset || !canTouch(asset, user)) return Response.json({ error: "That image isn't in your library." }, { status: 404 });
  if (!asset.mimeType.startsWith("image/")) {
    return Response.json({ error: "Only photos can be added inline — start a new project for extra footage." }, { status: 400 });
  }

  const source = await db.fableSource.create({
    data: {
      projectId: id,
      index: Math.max(-1, ...project.sources.map((s) => s.index)) + 1,
      assetId: asset.id,
      durationSecs: PHOTO_ANIMATE_MS / 1000,
      hasAudio: false,
      transcript: JSON.stringify({ text: "", words: [] }),
      status: "ready",
    },
  });
  return Response.json({ ok: true, index: source.index });
}
