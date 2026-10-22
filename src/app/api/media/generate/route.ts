// Inline media generation — one route for every "make me a visual right here"
// button (Templates, Director, Studio). Images via the app's image engine
// (optionally composed FROM a library photo); video via the plan's fal engine,
// quota-gated. Results are ordinary MediaAssets in the caller's library.

import { geminiImage, type SourceImage } from "@/lib/gemini";
import { falConnected, falVideo } from "@/lib/fal";
import { saveGeneratedAsset } from "@/lib/adstudio";
import { readMediaFile } from "@/lib/media";
import { canTouch, getSessionUser, scopeOf } from "@/lib/auth";
import { assertVideoQuota } from "@/lib/quota";
import { meterUsage } from "@/lib/events";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    kind?: string;
    prompt?: string;
    title?: string;
    imageAssetId?: string; // optional: a library photo as source/first frame
    seconds?: number;
    aspect?: string;
  } | null;
  const kind = body?.kind === "video" ? "video" : "image";
  const prompt = body?.prompt?.trim();
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
  const scope = scopeOf(user);
  try {
    let source: SourceImage | undefined;
    if (body?.imageAssetId) {
      const file = await readMediaFile(body.imageAssetId);
      if (!file || !canTouch(file.asset, user)) throw new Error("The selected photo isn't in your library.");
      if (!file.asset.mimeType.startsWith("image/")) throw new Error(`"${file.asset.originalName}" isn't an image.`);
      source = { mime: file.asset.mimeType, buffer: file.buffer };
    }

    if (kind === "image") {
      const img = await geminiImage(prompt, source ? [source] : []);
      const asset = await saveGeneratedAsset(img.buffer, img.mime, body?.title?.trim() || "Generated visual", scope);
      meterUsage(scope, "image_gen", 1, { kind: "inline" });
      return Response.json({ asset: { id: asset.id, url: `/api/media/${asset.id}/file`, kind: "image" } });
    }

    if (!(await falConnected())) {
      throw new Error("Video generation isn't connected yet — see the Connections page.");
    }
    await assertVideoQuota(1);
    const seconds = Math.max(4, Math.min(12, Math.round(body?.seconds ?? 7)));
    const aspect = body?.aspect === "16:9" ? "16:9" : "9:16";
    // Sound on by default (ambience sells the clip); silent retry if the
    // generated audio trips fal's content filter.
    const buffer = await falVideo(prompt, source, seconds, aspect, true).catch(() =>
      falVideo(prompt, source, seconds, aspect, false)
    );
    const asset = await saveGeneratedAsset(buffer, "video/mp4", body?.title?.trim() || "Generated clip", scope);
    meterUsage(scope, "video_gen", 1, { kind: "inline" });
    return Response.json({ asset: { id: asset.id, url: `/api/media/${asset.id}/file`, kind: "video" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
