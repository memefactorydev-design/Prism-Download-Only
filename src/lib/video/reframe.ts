// Active-speaker reframe (Opus "ReframeAnything" equivalent, built locally).
// Blueprint from SupoClip (AGPL — studied, not copied): detect the subject per
// sampled frame and pan a vertical crop to follow them. We use on-device object
// detection via @huggingface/transformers (ONNX, already a dep) instead of
// MediaPipe, so nothing leaves the machine and there's no Python service.
//
// Detection runs ONCE per source (sampled, cached on VideoJob.subjectTrack like
// the transcript); each clip slices the track. Worker-only — never imported by
// the web bundle.

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { runFfmpeg } from "@/lib/video/ffmpeg";
import { toOutMs, type TimelineEntry } from "@/lib/video/timeline";

export interface TrackPoint {
  tMs: number; // source timestamp
  cxNorm: number; // subject centre-x, 0..1 of frame width
  conf: number; // detection confidence (0 = nothing found, filled from neighbours)
}

const TMP_DIR = path.join(process.cwd(), "uploads", "tmp");
const BASE_FPS = Number(process.env.REFRAME_FPS) || 1; // detection sample rate (per second)
const MAX_FRAMES = 400; // hard cap on frames detected (fps scales down beyond this)
const DETECT_W = 512; // downscale frames for faster detection (cx stays normalised)
const OUT_W = 1080;
const OUT_H = 1920;

export interface DetectOptions {
  // Only detect within these source-time ranges (the selected clip segments) so a
  // long source isn't scanned end-to-end — the big speed win.
  ranges?: { startMs: number; endMs: number }[];
  onProgress?: (done: number, total: number) => void | Promise<void>;
}

// Lazily build the detector once per process — model load is expensive.
let detectorPromise: Promise<(img: unknown, opts: unknown) => Promise<unknown>> | null = null;
async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      if (process.env.TRANSFORMERS_CACHE) env.cacheDir = process.env.TRANSFORMERS_CACHE;
      const model = process.env.DETECTION_MODEL || "Xenova/yolos-tiny";
      const det = await pipeline("object-detection", model);
      return det as unknown as (img: unknown, opts: unknown) => Promise<unknown>;
    })();
  }
  return detectorPromise;
}

interface DetBox {
  label?: string;
  score?: number;
  box?: { xmin: number; xmax: number; ymin?: number; ymax?: number };
}

/** Sample frames within the given ranges and detect the primary person's
 *  centre-x over time. Detects only the selected clip ranges (not the whole
 *  source) and reports progress, so long 4K sources stay tractable. */
export async function detectSubjectTrack(
  sourcePath: string,
  durationSecs: number,
  opts: DetectOptions = {}
): Promise<TrackPoint[]> {
  const ranges = (opts.ranges?.length
    ? opts.ranges
    : [{ startMs: 0, endMs: Math.round(durationSecs * 1000) }]
  )
    .map((r) => ({ startMs: Math.max(0, r.startMs), endMs: r.endMs }))
    .filter((r) => r.endMs > r.startMs);
  const totalSecs = Math.max(1, ranges.reduce((a, r) => a + (r.endMs - r.startMs), 0) / 1000);
  const fps = Math.max(0.3, Math.min(BASE_FPS, MAX_FRAMES / totalSecs));

  const dir = path.join(TMP_DIR, `frames-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });

  try {
    // Extract downscaled frames only inside each range (fast input-seek per range).
    const frames: { path: string; tMs: number }[] = [];
    for (let ri = 0; ri < ranges.length; ri++) {
      const r = ranges[ri];
      const rdir = path.join(dir, `r${ri}`);
      await fs.mkdir(rdir, { recursive: true });
      await runFfmpeg([
        "-ss",
        (r.startMs / 1000).toFixed(3),
        "-to",
        (r.endMs / 1000).toFixed(3),
        "-i",
        sourcePath,
        "-vf",
        `fps=${fps.toFixed(3)},scale=${DETECT_W}:-2`,
        "-q:v",
        "3",
        path.join(rdir, "f_%05d.png"),
      ]);
      const list = (await fs.readdir(rdir)).filter((f) => f.endsWith(".png")).sort();
      list.forEach((f, i) => frames.push({ path: path.join(rdir, f), tMs: Math.round(r.startMs + (i / fps) * 1000) }));
    }

    const { RawImage } = await import("@huggingface/transformers");
    const detector = await getDetector();

    const raw: TrackPoint[] = [];
    for (let i = 0; i < frames.length; i++) {
      let cxNorm = 0.5;
      let conf = 0;
      try {
        const image = await RawImage.read(frames[i].path);
        const out = (await detector(image, { threshold: 0.4, percentage: true })) as DetBox[];
        const persons = out.filter((d) => d.label === "person" && d.box);
        const pool = persons.length ? persons : out.filter((d) => d.box);
        let best: DetBox | null = null;
        let bestArea = 0;
        for (const d of pool) {
          const b = d.box!;
          const area = (b.xmax - b.xmin) * ((b.ymax ?? 1) - (b.ymin ?? 0));
          if (area > bestArea) {
            bestArea = area;
            best = d;
          }
        }
        if (best?.box) {
          cxNorm = Math.min(1, Math.max(0, (best.box.xmin + best.box.xmax) / 2));
          conf = best.score ?? 0.5;
        }
      } catch {
        // Unreadable frame — leave as a low-confidence gap, filled below.
      }
      raw.push({ tMs: frames[i].tMs, cxNorm, conf });
      if (opts.onProgress && (i % 10 === 0 || i === frames.length - 1)) {
        await opts.onProgress(i + 1, frames.length);
      }
    }
    raw.sort((a, b) => a.tMs - b.tMs);
    return smooth(fillGaps(raw));
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Carry the last confident centre across frames where nothing was detected.
function fillGaps(track: TrackPoint[]): TrackPoint[] {
  if (!track.length) return track;
  let lastCx = track.find((p) => p.conf > 0)?.cxNorm ?? 0.5;
  const out = track.map((p) => {
    if (p.conf > 0) lastCx = p.cxNorm;
    return { ...p, cxNorm: p.conf > 0 ? p.cxNorm : lastCx };
  });
  // Backfill the leading low-confidence run with the first confident value.
  const firstConf = out.find((p) => p.conf > 0)?.cxNorm ?? 0.5;
  for (const p of out) {
    if (p.conf > 0) break;
    p.cxNorm = firstConf;
  }
  return out;
}

// Moving average so the crop glides rather than snapping between frames.
function smooth(track: TrackPoint[], window = 3): TrackPoint[] {
  if (track.length <= 2) return track;
  return track.map((p, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(track.length - 1, i + window); j++) {
      sum += track[j].cxNorm;
      n++;
    }
    return { ...p, cxNorm: sum / n };
  });
}

// Linear-interpolate the subject centre at an arbitrary source time.
function cxAt(track: TrackPoint[], tMs: number): number {
  if (!track.length) return 0.5;
  if (tMs <= track[0].tMs) return track[0].cxNorm;
  if (tMs >= track[track.length - 1].tMs) return track[track.length - 1].cxNorm;
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].tMs <= tMs) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  const f = (tMs - a.tMs) / Math.max(1, b.tMs - a.tMs);
  return a.cxNorm + (b.cxNorm - a.cxNorm) * f;
}

/** Even width the source becomes when scaled to OUT_H, keeping aspect ratio. */
export function scaledWidth(srcW: number, srcH: number): number {
  const w = Math.round((srcW * OUT_H) / srcH);
  return w - (w % 2);
}

/**
 * Build an ffmpeg `sendcmd` script that pans a named crop (crop@cam) to follow
 * the subject, on the clip's OUTPUT timeline (segments concatenated, cuts
 * removed). Returns the script text and the initial x. Emits ~10 keyframes/sec,
 * skipping near-identical positions.
 */
export function buildCropScript(
  entries: TimelineEntry[],
  track: TrackPoint[],
  scaledW: number
): { script: string; initialX: number } {
  const maxX = Math.max(0, scaledW - OUT_W);
  const lines: string[] = [];
  let lastX = -999;
  const initialX = clamp(
    Math.round(cxAt(track, entries[0]?.srcStartMs ?? 0) * scaledW - OUT_W / 2),
    0,
    maxX
  );

  for (const seg of entries) {
    // Step the SOURCE domain by 100ms of OUTPUT time (~10 keyframes/sec on
    // screen regardless of the entry's speed); toOutMs places each keyframe.
    const stepMs = Math.max(1, Math.round(100 * seg.speed));
    for (let t = seg.srcStartMs; t < seg.srcEndMs; t += stepMs) {
      const x = clamp(Math.round(cxAt(track, t) * scaledW - OUT_W / 2), 0, maxX);
      if (Math.abs(x - lastX) >= 2) {
        const sec = toOutMs(seg, t) / 1000;
        lines.push(`${sec.toFixed(3)} crop@cam x ${x};`);
        lastX = x;
      }
    }
  }
  if (!lines.length) lines.push(`0.000 crop@cam x ${initialX};`);
  return { script: lines.join("\n") + "\n", initialX };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
