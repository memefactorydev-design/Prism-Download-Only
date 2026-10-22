// Photo animation for Director photo sources. Worker-only (fal import — never
// the web bundle).
//
// A scene planned on a PHOTO source is executed against an ANIMATED clip: the
// still becomes PHOTO_ANIMATE_MS of live footage on the plan's fal engine
// (image-to-video, Kling on lower tiers / Seedance on upper), and the scene's
// trims/speed/captions then treat it exactly like uploaded footage — the
// timeline model and concat architecture need no special cases.
//
// Animations are cached as MediaAssets under a deterministic content-hash name
// (`animate-<hash>.mp4`, keyed on photo bytes + motion + engine), so re-finals,
// retries and repeated scenes on the same (photo, motion) re-spend nothing.
// Unlike morph bridges, an animated photo is CORE content — failures throw
// (fail loudly) rather than degrade; the render route pre-gates the quota.

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { falVideo, planVideoEngine } from "@/lib/fal";
import { getStorage, localFilePath } from "@/lib/storage";
import { meterUsage } from "@/lib/events";
import { probeVideo } from "@/lib/video/probe";
import { PHOTO_ANIMATE_MS } from "@/lib/video/transitions";

export interface AnimationResult {
  assetId: string;
  path: string; // absolute local path, ready to feed ffmpeg as a source
  durationSecs: number;
  cached: boolean;
  engine: string;
}

/** Animate one photo with one motion direction (content-hash cached). */
export async function resolveAnimation(opts: {
  photoPath: string;
  photoMime: string;
  motion: string;
  userId: string;
  jobId: string;
}): Promise<AnimationResult> {
  const photo = await fs.readFile(opts.photoPath);
  const engine = planVideoEngine();
  const hash = createHash("sha256")
    .update(photo)
    .update(opts.motion)
    .update(engine)
    .digest("hex")
    .slice(0, 24);
  const name = `animate-${hash}.mp4`;

  const cached = await db.mediaAsset.findFirst({ where: { originalName: name } });
  if (cached) {
    const p = localFilePath({ storageDriver: cached.storageDriver as "local" | "s3", storagePath: cached.storagePath });
    const probe = await probeVideo(p);
    return { assetId: cached.id, path: p, durationSecs: probe.durationSecs, cached: true, engine };
  }

  const prompt = `${opts.motion}. Animate this exact scene faithfully — keep every object, material and light as photographed; premium cinematic interior film, no text.`;
  const buffer = await falVideo(
    prompt,
    { mime: opts.photoMime, buffer: photo },
    Math.round(PHOTO_ANIMATE_MS / 1000),
    "9:16",
    false // photo scenes are muted by the sanitizer — engine audio is never used
  );
  const stored = await getStorage().save(buffer, ".mp4");
  const asset = await db.mediaAsset.create({
    data: {
      userId: opts.userId,
      originalName: name,
      mimeType: "video/mp4",
      sizeBytes: buffer.byteLength,
      storageDriver: stored.storageDriver,
      storagePath: stored.storagePath,
    },
  });
  meterUsage(opts.userId, "video_gen", 1, { kind: "animate", jobId: opts.jobId, engine });
  const p = localFilePath({ storageDriver: stored.storageDriver as "local" | "s3", storagePath: stored.storagePath });
  const probe = await probeVideo(p);
  return { assetId: asset.id, path: p, durationSecs: probe.durationSecs, cached: false, engine };
}
