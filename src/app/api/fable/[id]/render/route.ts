// Freeze the working plan into an immutable FableRevision and enqueue its
// render job. The route only enqueues — the worker executes (house pattern).

import { db } from "@/lib/db";
import { type FablePlan } from "@/lib/fable";
import { canTouch, getSessionUser } from "@/lib/auth";
import { assertVideoQuota } from "@/lib/quota";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { quality?: string };
  const quality = body.quality === "final" ? "final" : "draft";

  const project = await db.fableProject.findUnique({
    where: { id },
    include: { sources: { orderBy: { index: "asc" } }, revisions: { orderBy: { number: "desc" }, take: 1 } },
  });
  if (!project || !canTouch(project, user)) return Response.json({ error: "Project not found." }, { status: 404 });
  if (!project.plan) return Response.json({ error: "No plan yet — describe your video to the Director first." }, { status: 400 });
  const plan = JSON.parse(project.plan) as FablePlan;

  // One render at a time per project keeps the story simple (and the CPU sane).
  const activeJobs = await db.videoJob.count({
    where: { fableProjectId: id, mode: "fable", status: { in: ["queued", "probing", "transcribing", "planning", "rendering"] } },
  });
  if (activeJobs > 0) {
    return Response.json({ error: "A render is already in progress — it'll be done shortly." }, { status: 409 });
  }

  // Photo scenes animate at render time (one generation per distinct
  // photo+motion pair) — gate the whole spend up-front so the job never dies
  // mid-render on quota. Cached animations may make the real spend lower;
  // over-asking is the safe direction.
  const sourceAssets = await db.mediaAsset.findMany({ where: { id: { in: project.sources.map((s) => s.assetId) } } });
  const photoAssetIds = new Set(sourceAssets.filter((a) => a.mimeType.startsWith("image/")).map((a) => a.id));
  const photoIndices = new Set(project.sources.filter((s) => photoAssetIds.has(s.assetId)).map((s) => s.index));
  const animations = new Set(
    plan.scenes.filter((sc) => photoIndices.has(sc.sourceIndex)).map((sc) => `${sc.sourceIndex}|${sc.motion ?? ""}`)
  );
  if (animations.size) {
    try {
      await assertVideoQuota(animations.size);
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
    }
  }

  const job = await db.videoJob.create({
    data: {
      userId: project.userId, // render inherits the project's sandbox
      mode: "fable",
      sourceAssetId: project.sources[0]?.assetId ?? "",
      outputKinds: "reel",
      fableProjectId: id,
      fablePlan: project.plan,
      draft: quality === "draft",
      captionStyle: plan.captionStyle,
      stage: "Queued",
      // Copy cached transcripts so the worker never re-transcribes.
      sources: {
        create: project.sources.map((s) => ({
          index: s.index,
          assetId: s.assetId,
          transcript: s.transcript,
          width: s.width,
          height: s.height,
          durationSecs: s.durationSecs,
        })),
      },
    },
  });
  const revision = await db.fableRevision.create({
    data: {
      projectId: id,
      number: (project.revisions[0]?.number ?? 0) + 1,
      quality,
      plan: project.plan,
      jobId: job.id,
    },
  });
  return Response.json({ revisionId: revision.id, number: revision.number, jobId: job.id });
}
