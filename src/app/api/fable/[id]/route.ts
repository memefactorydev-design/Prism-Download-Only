// One Director project: the editor's single poll target — project + plan +
// messages + revisions with their render jobs' live status/clips. DELETE
// removes the project (rendered clips/assets survive in the media library).

import { db } from "@/lib/db";
import { canTouch, getSessionUser } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const project = await db.fableProject.findUnique({
    where: { id },
    include: {
      sources: { orderBy: { index: "asc" } },
      messages: { orderBy: { createdAt: "asc" }, take: 200 },
      revisions: { orderBy: { number: "desc" }, take: 25 },
    },
  });
  if (!project || !canTouch(project, user)) return Response.json({ error: "Project not found." }, { status: 404 });

  const jobIds = project.revisions.map((r) => r.jobId);
  const jobs = await db.videoJob.findMany({
    where: { id: { in: jobIds } },
    include: { clips: true },
  });
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const assetIds = project.sources.map((s) => s.assetId);
  const assets = await db.mediaAsset.findMany({ where: { id: { in: assetIds } } });
  const assetById = new Map(assets.map((a) => [a.id, a]));

  return Response.json({
    id: project.id,
    title: project.title,
    status: project.status,
    errorMessage: project.errorMessage,
    plan: project.plan ? JSON.parse(project.plan) : null,
    planVersion: project.planVersion,
    sources: project.sources.map((s) => ({
      index: s.index,
      assetId: s.assetId,
      name: assetById.get(s.assetId)?.originalName ?? "missing",
      durationSecs: s.durationSecs,
      hasAudio: s.hasAudio,
      status: s.status,
    })),
    messages: project.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      hasSnapshot: Boolean(m.planSnapshot),
      createdAt: m.createdAt.toISOString(),
    })),
    revisions: project.revisions.map((r) => {
      const job = jobById.get(r.jobId);
      const clip = job?.clips[0];
      return {
        id: r.id,
        number: r.number,
        quality: r.quality,
        createdAt: r.createdAt.toISOString(),
        job: job
          ? {
              status: job.status,
              stage: job.stage,
              progress: job.progress,
              errorMessage: job.errorMessage,
            }
          : null,
        clipAssetId: clip?.status === "rendered" ? clip.assetId : null,
        clipId: clip?.id ?? null,
      };
    }),
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const project = await db.fableProject.findUnique({ where: { id } });
  if (project && canTouch(project, user)) {
    await db.fableProject.delete({ where: { id } }).catch(() => {});
  }
  return Response.json({ ok: true });
}
