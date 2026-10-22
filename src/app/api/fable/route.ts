// Director projects: list + create. Creation stages the chosen video/photo assets as
// FableSources and enqueues a "fable_prep" worker job (probe + transcribe once
// per project) — the route only enqueues, per the house pattern.

import { db } from "@/lib/db";
import { getSessionUser, scopeOf, scopeWhere } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const projects = await db.fableProject.findMany({
    where: scopeWhere(user),
    orderBy: { updatedAt: "desc" },
    include: { sources: true, revisions: { orderBy: { number: "desc" }, take: 1 } },
  });
  return Response.json({
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      sourceCount: p.sources.length,
      latestRevision: p.revisions[0]
        ? { number: p.revisions[0].number, quality: p.revisions[0].quality }
        : null,
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  const body = (await request.json().catch(() => null)) as { title?: string; assetIds?: string[] } | null;
  const assetIds = [...new Set(body?.assetIds ?? [])].slice(0, 8);
  if (!assetIds.length) {
    return Response.json({ error: "Pick at least one video or photo from the library." }, { status: 400 });
  }
  // Members can only cut footage from their own library.
  const assets = await db.mediaAsset.findMany({
    where: { id: { in: assetIds }, ...(user.role === "admin" ? {} : { userId: user.id }) },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const id of assetIds) {
    const a = byId.get(id);
    if (!a) return Response.json({ error: `Asset ${id} was not found in your library.` }, { status: 400 });
    if (!a.mimeType.startsWith("video/") && !a.mimeType.startsWith("image/")) {
      return Response.json({ error: `"${a.originalName}" isn't a video or photo.` }, { status: 400 });
    }
  }

  const project = await db.fableProject.create({
    data: {
      userId: scope,
      title: body?.title?.trim() || `Cut of ${byId.get(assetIds[0])!.originalName}`,
      sources: {
        create: assetIds.map((assetId, index) => ({ index, assetId })),
      },
    },
  });
  // Prep job: worker probes + transcribes every source, then flips the project
  // to "ready" so the chat opens.
  await db.videoJob.create({
    data: {
      userId: scope,
      mode: "fable_prep",
      sourceAssetId: assetIds[0],
      outputKinds: "reel",
      fableProjectId: project.id,
      stage: "Queued",
    },
  });
  return Response.json({ id: project.id });
}
