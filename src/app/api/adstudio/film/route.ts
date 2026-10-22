// Enqueue a stitched ad film: the ad-video-director-agent plans segments (each
// within the engine's per-render time limit), the worker renders them on
// Seedance (Veo backup), stitches one cut, and adds ElevenLabs VO + captions.
// Heavy work lives in the worker — this route only creates the VideoJob.

import { db } from "@/lib/db";
import { canTouch, getSessionUser, scopeOf } from "@/lib/auth";
import { readMediaFile } from "@/lib/media";
import { SEEDANCE_MAX_SECS } from "@/lib/fal";
import { assertVideoQuota } from "@/lib/quota";
import type { AdFilmBrief } from "@/worker/process-adfilm";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    prompt?: string;
    targetSecs?: number;
    imageAssetId?: string;
    title?: string;
  } | null;
  if (!body?.prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
  try {
    if (body.imageAssetId) {
      const file = await readMediaFile(body.imageAssetId);
      if (!file || !canTouch(file.asset, user)) throw new Error("The selected photo isn't in your library.");
      if (!file.asset.mimeType.startsWith("image/")) throw new Error(`"${file.asset.originalName}" isn't an image.`);
    }
    const targetSecs = Math.max(8, Math.min(90, Math.round(body.targetSecs || 24)));
    // A film consumes at least ceil(target / per-render cap) generations —
    // gate the whole spend up-front so jobs never die mid-render on quota.
    await assertVideoQuota(Math.ceil(targetSecs / SEEDANCE_MAX_SECS));
    const brief: AdFilmBrief = {
      prompt: body.prompt.trim(),
      targetSecs,
      imageAssetId: body.imageAssetId || undefined,
      title: body.title?.trim() || "Ad film",
    };
    const job = await db.videoJob.create({
      data: {
        userId: scopeOf(user),
        mode: "adfilm",
        sourceAssetId: "", // segments are generated, not uploaded
        outputKinds: "ad",
        voBrief: JSON.stringify(brief),
        stage: "Queued",
      },
    });
    return Response.json({ jobId: job.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
