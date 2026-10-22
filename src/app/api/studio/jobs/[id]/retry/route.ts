// The failure fork (P0.3): a failed Studio job offers two honest exits —
// "try again" (same mode, same source) or "re-cut with a voice-over"
// (narration carries footage that lacks a strong standalone moment).

import { db } from "@/lib/db";
import { enqueueJob, enqueueMontage, enqueueVoiceover } from "@/lib/studio";
import { canTouch, getSessionUser } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const job = await db.videoJob.findUnique({ where: { id } });
  if (!job || !canTouch(job, user)) return Response.json({ error: "Job not found." }, { status: 404 });
  if (!["failed", "partial", "complete"].includes(job.status)) {
    return Response.json({ error: "This job is still running." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { as?: string };
  const options = { captionStyle: job.captionStyle ?? undefined, effects: job.effects, sfx: job.sfx };

  try {
    let next;
    if (body.as === "voiceover") {
      next = await enqueueVoiceover(job.sourceAssetId, options, job.musicAssetId, job.userId);
    } else if (job.mode === "montage") {
      // Montage retry re-runs against the SAME source set.
      const sources = await db.videoSource.findMany({ where: { jobId: job.id }, orderBy: { index: "asc" } });
      next = await enqueueMontage(sources.map((s) => s.assetId), options, job.musicAssetId, job.userId);
    } else {
      next = await enqueueJob(job.sourceAssetId, job.outputKinds.split(","), options, job.musicAssetId, job.userId);
    }
    return Response.json({ jobId: next.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
