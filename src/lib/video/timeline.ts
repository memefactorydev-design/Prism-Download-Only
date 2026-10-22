// The ONE timing model for rendered clips. Every millisecond that reaches
// ffmpeg, a caption line, an emoji overlay, an SFX delay, a crop keyframe, a
// music trim or a VO-fit check derives from buildTimeline() — the old identity
// "output time = Σ source segment durations" becomes "output time =
// Σ outDurMs" and nothing else is allowed to compute it. Pure math, no
// node/ffmpeg imports (fable.ts and web-safe callers may import it).

import type { EdlSegment } from "@/lib/video/edl";
import type { SegmentEffect } from "@/lib/video/effects";

export interface TimelineEntry {
  sourceIndex: number;
  /** Trim in-point, source time. */
  srcStartMs: number;
  /** EFFECTIVE trim out-point (post beat-clamp), source time. */
  srcEndMs: number;
  /** Playback rate; 1 = normal. Renderer accepts (0.2, 4] — bridges use ~3.1. */
  speed: number;
  /** Cumulative output position of this entry's first frame. */
  outStartMs: number;
  /** round((srcEndMs - srcStartMs) / speed) — this entry's output length. */
  outDurMs: number;
  effect?: SegmentEffect;
}

/**
 * Build the output timeline for a segment list.
 *
 * `beatDurationsMs[i]` (when given and > 0) is a per-segment OUTPUT duration
 * cap from beat-sync — the clamp happens in the SOURCE domain so a slowed
 * segment consumes `beat × speed` source ms to fill `beat` output ms:
 * srcSpan = min(rawSpan, round(beat × speed)); outDur = round(srcSpan / speed).
 */
export function buildTimeline(segments: EdlSegment[], beatDurationsMs?: number[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let outStartMs = 0;
  segments.forEach((seg, i) => {
    const speed = typeof seg.speed === "number" && seg.speed > 0.2 && seg.speed <= 4 ? seg.speed : 1;
    const rawSpanMs = Math.max(0, seg.endMs - seg.startMs);
    const beat = beatDurationsMs?.[i];
    const srcSpanMs = beat && beat > 0 ? Math.min(rawSpanMs, Math.round(beat * speed)) : rawSpanMs;
    const outDurMs = Math.round(srcSpanMs / speed);
    entries.push({
      sourceIndex: seg.sourceIndex ?? 0,
      srcStartMs: seg.startMs,
      srcEndMs: seg.startMs + srcSpanMs,
      speed,
      outStartMs,
      outDurMs,
      effect: seg.effect,
    });
    outStartMs += outDurMs;
  });
  return entries;
}

/** Total output length in ms. */
export function timelineOutDurMs(entries: TimelineEntry[]): number {
  const last = entries[entries.length - 1];
  return last ? last.outStartMs + last.outDurMs : 0;
}

/** Map a source-time ms (clamped into the entry's span) to output-time ms. */
export function toOutMs(e: TimelineEntry, srcMs: number): number {
  const clamped = Math.max(e.srcStartMs, Math.min(srcMs, e.srcEndMs));
  return e.outStartMs + Math.round((clamped - e.srcStartMs) / e.speed);
}
