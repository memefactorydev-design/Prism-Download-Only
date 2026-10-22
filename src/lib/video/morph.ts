// Morph/dissolve bridge generation for scene transitions. Worker-only (ffmpeg
// + fal imports — never the web bundle).
//
// A bridge is a short standalone clip inserted BETWEEN two segments as a
// first-class (muted) timeline entry, so the ONE-interleaved-concat render
// architecture needs no special cases:
// - "morph": Seedance renders prev-scene-last-frame → next-scene-first-frame
//   (its 4s minimum is time-compressed to ~1.3s by the timeline's speed);
//   frames are extracted PRE-CROPPED to the output frame so the morph's
//   endpoints visually match the rendered footage either side.
// - "dissolve": a free ffmpeg still-crossfade (0.6s) — also the automatic
//   fallback for drafts, missing fal, over-cap morphs and Seedance failures.
//
// AI bridges are cached as MediaAssets under a deterministic content-hash name
// (`morph-<hash>.mp4`), so a Director re-final or retry re-spends nothing.

import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { db } from "@/lib/db";
import { falVideo, SEEDANCE_MIN_SECS } from "@/lib/fal";
import { getStorage, localFilePath } from "@/lib/storage";
import { meterUsage } from "@/lib/events";
import { assertVideoQuota } from "@/lib/quota";
import { runFfmpeg } from "@/lib/video/ffmpeg";
import { probeVideo } from "@/lib/video/probe";
import { DISSOLVE_BRIDGE_OUT_MS } from "@/lib/video/transitions";

const TMP_DIR = path.join(process.cwd(), "uploads", "tmp");
const OUT_W = 1080;
const OUT_H = 1920;

const MORPH_PROMPT =
  "Seamless cinematic morph transition between the two frames: one smooth continuous transformation, no cuts, no text, premium and restrained.";

/** Extract one frame at `atMs`, pre-cropped to the 9:16 output frame so the
 *  bridge's endpoints match the rendered footage either side of it.
 *  A seek right at a file's tail can land past the last decodable frame —
 *  ffmpeg then exits cleanly having written NOTHING — so back off in steps
 *  until a frame materializes. */
export async function extractStyledFrame(sourcePath: string, atMs: number): Promise<string> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const out = path.join(TMP_DIR, `frame-${randomUUID()}.png`);
  for (const backoffMs of [0, 200, 700, 1500]) {
    const at = Math.max(0, atMs - backoffMs);
    await runFfmpeg([
      "-y",
      "-ss",
      (at / 1000).toFixed(3),
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H}`,
      out,
    ]);
    try {
      await fs.access(out);
      return out;
    } catch {
      /* no frame at this seek — back off and retry */
    }
  }
  throw new Error(`No decodable frame near ${atMs}ms in ${path.basename(sourcePath)}`);
}

/** Free fallback bridge: a still-to-still crossfade, silent, 30fps 9:16. */
async function dissolveBridge(pngA: string, pngB: string): Promise<Buffer> {
  const out = path.join(TMP_DIR, `bridge-${randomUUID()}.mp4`);
  const dur = DISSOLVE_BRIDGE_OUT_MS / 1000;
  // xfade output length = A + B − fadeDuration; a fade spanning the WHOLE
  // bridge (offset 0) gives exactly `dur` and reads as one clean dissolve.
  await runFfmpeg([
    "-y",
    "-loop", "1", "-t", dur.toFixed(3), "-framerate", "30", "-i", pngA,
    "-loop", "1", "-t", dur.toFixed(3), "-framerate", "30", "-i", pngB,
    "-filter_complex",
    `[0:v][1:v]xfade=transition=fade:duration=${dur.toFixed(3)}:offset=0,format=yuv420p[v]`,
    "-map", "[v]",
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    out,
  ]);
  try {
    return await fs.readFile(out);
  } finally {
    await fs.unlink(out).catch(() => {});
  }
}

export interface BridgeResult {
  assetId: string;
  path: string; // absolute local path, ready to feed ffmpeg as a source
  durationSecs: number;
  kind: "morph" | "dissolve";
  cached: boolean;
}

async function saveBridgeAsset(buffer: Buffer, name: string, userId: string): Promise<{ id: string; path: string }> {
  const stored = await getStorage().save(buffer, ".mp4");
  const asset = await db.mediaAsset.create({
    data: {
      userId,
      originalName: name,
      mimeType: "video/mp4",
      sizeBytes: buffer.byteLength,
      storageDriver: stored.storageDriver,
      storagePath: stored.storagePath,
    },
  });
  return { id: asset.id, path: localFilePath({ storageDriver: stored.storageDriver as "local" | "s3", storagePath: stored.storagePath }) };
}

/**
 * Resolve one bridge between two already-extracted frames. `useAi` = false
 * (drafts, no fal, over budget) renders the free dissolve; morph failures
 * degrade to the dissolve with a console warn — a transition is decoration,
 * never a job-killer. Returns the bridge as a MediaAsset + its real duration.
 */
export async function resolveBridge(opts: {
  framePathA: string;
  framePathB: string;
  useAi: boolean;
  userId: string;
  jobId: string;
}): Promise<BridgeResult> {
  const [a, b] = await Promise.all([fs.readFile(opts.framePathA), fs.readFile(opts.framePathB)]);

  if (opts.useAi) {
    // Content-hash cache: the same two endpoint frames always yield the same
    // bridge asset — re-finals and retries re-spend nothing.
    const hash = createHash("sha256").update(a).update(b).digest("hex").slice(0, 24);
    const name = `morph-${hash}.mp4`;
    const cached = await db.mediaAsset.findFirst({ where: { originalName: name } });
    if (cached) {
      const p = localFilePath({ storageDriver: cached.storageDriver as "local" | "s3", storagePath: cached.storagePath });
      const probe = await probeVideo(p);
      return { assetId: cached.id, path: p, durationSecs: probe.durationSecs, kind: "morph", cached: true };
    }
    try {
      // Quota-exhausted throws into this catch → free dissolve, job lives.
      await assertVideoQuota(1);
      const buffer = await falVideo(
        MORPH_PROMPT,
        { mime: "image/png", buffer: a },
        SEEDANCE_MIN_SECS,
        "9:16",
        false,
        { mime: "image/png", buffer: b }
      );
      const saved = await saveBridgeAsset(buffer, name, opts.userId);
      meterUsage(opts.userId, "video_gen", 1, { kind: "morph", jobId: opts.jobId });
      const probe = await probeVideo(saved.path);
      return { assetId: saved.id, path: saved.path, durationSecs: probe.durationSecs, kind: "morph", cached: false };
    } catch (err) {
      console.error("[morph] Seedance bridge failed, using dissolve:", err instanceof Error ? err.message : err);
    }
  }

  const buffer = await dissolveBridge(opts.framePathA, opts.framePathB);
  const saved = await saveBridgeAsset(buffer, `dissolve-${randomUUID().slice(0, 8)}.mp4`, opts.userId);
  const probe = await probeVideo(saved.path);
  return { assetId: saved.id, path: saved.path, durationSecs: probe.durationSecs, kind: "dissolve", cached: false };
}
