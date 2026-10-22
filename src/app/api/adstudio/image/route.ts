// Nano Banana image generation for Ad Studio. With assetIds, the owner's real
// photos are supplied as source images and the prompt acts as an EDIT
// instruction — grounded ads from real footage, not invented kitchens.

import { geminiImage, type SourceImage } from "@/lib/gemini";
import { saveGeneratedAsset } from "@/lib/adstudio";
import { meterUsage } from "@/lib/events";
import { readMediaFile } from "@/lib/media";
import { canTouch, getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    prompt?: string;
    title?: string;
    assetIds?: string[];
  } | null;
  if (!body?.prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
  try {
    const sources: SourceImage[] = [];
    for (const id of (body.assetIds ?? []).slice(0, 3)) {
      const file = await readMediaFile(id);
      if (!file || !canTouch(file.asset, user)) throw new Error(`Selected photo ${id} isn't in your library.`);
      if (!file.asset.mimeType.startsWith("image/")) throw new Error(`"${file.asset.originalName}" isn't an image.`);
      sources.push({ mime: file.asset.mimeType, buffer: file.buffer });
    }
    // One image engine app-wide: Gemini Nano Banana (latest).
    const img = await geminiImage(body.prompt.trim(), sources);
    const asset = await saveGeneratedAsset(img.buffer, img.mime, body.title?.trim() || "Generated ad image", scopeOf(user));
    meterUsage(asset.userId, "image_gen", 1);
    return Response.json({ asset: { id: asset.id, url: `/api/media/${asset.id}/file` } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
