import { startVeoVideo, veoStatus } from "@/lib/gemini";
import { falConnected, falVideo, planVideoEngine, SEEDANCE_MAX_SECS } from "@/lib/fal";
import { readMediaFile } from "@/lib/media";
import { saveGeneratedAsset } from "@/lib/adstudio";
import { canTouch, getSessionUser, scopeOf } from "@/lib/auth";
import { meterUsage } from "@/lib/events";
import { assertVideoQuota } from "@/lib/quota";

export const maxDuration = 300;

// Single-clip generation. Seedance (fal) is the PRIMARY engine — it runs
// synchronously in this request and the asset comes straight back. Veo
// (Gemini) is the BACKUP: used when fal isn't connected, when Seedance fails,
// or when explicitly requested — it returns an operation the client polls via
// GET. Longer stitched ads with VO + captions go through /api/adstudio/film.
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    prompt?: string;
    imageAssetId?: string; // optional: the owner's photo becomes the first frame
    engine?: string; // "seedance" (fal, default) | "veo" (Gemini, backup)
    seconds?: number; // requested clip length (clamped to the engine's cap)
    title?: string;
  } | null;
  if (!body?.prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
  try {
    await assertVideoQuota(1);
    let firstFrame;
    if (body.imageAssetId) {
      const file = await readMediaFile(body.imageAssetId);
      if (!file || !canTouch(file.asset, user)) throw new Error("The selected photo isn't in your library.");
      if (!file.asset.mimeType.startsWith("image/")) throw new Error(`"${file.asset.originalName}" isn't an image.`);
      firstFrame = { mime: file.asset.mimeType, buffer: file.buffer };
    }
    const wantVeo = body.engine === "veo";
    if (!wantVeo && (await falConnected())) {
      try {
        const buffer = await falVideo(body.prompt.trim(), firstFrame, body.seconds ?? 5);
        const asset = await saveGeneratedAsset(buffer, "video/mp4", body.title?.trim() || "Generated ad video", scopeOf(user));
        meterUsage(asset.userId, "video_gen", 1, { engine: planVideoEngine(), capSecs: SEEDANCE_MAX_SECS });
        return Response.json({ done: true, engine: planVideoEngine(), asset: { id: asset.id, url: `/api/media/${asset.id}/file` } });
      } catch (err) {
        // Backup engine: Veo picks the brief up when Seedance can't deliver.
        console.error("[adstudio] fal engine failed, falling back to Veo:", err);
      }
    }
    return Response.json({
      operation: await startVeoVideo(body.prompt.trim(), firstFrame),
      engine: "veo",
      fellBack: !wantVeo && (await falConnected()) ? true : undefined,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const url = new URL(request.url);
  const op = url.searchParams.get("op");
  if (!op) return Response.json({ error: "op is required" }, { status: 400 });
  try {
    const status = await veoStatus(op);
    if (!status.done) return Response.json({ done: false });
    if (status.error || !status.buffer) return Response.json({ done: true, error: status.error ?? "No video returned" });
    const asset = await saveGeneratedAsset(
      status.buffer,
      "video/mp4",
      url.searchParams.get("title")?.trim() || "Generated ad video",
      scopeOf(user)
    );
    meterUsage(asset.userId, "video_gen", 1, { engine: "veo", capSecs: 8 });
    return Response.json({ done: true, engine: "veo", asset: { id: asset.id, url: `/api/media/${asset.id}/file` } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
