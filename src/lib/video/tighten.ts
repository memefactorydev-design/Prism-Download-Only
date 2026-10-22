// Filler-word + dead-air removal (opt-in via job.tightEdit). Pure function over an
// EdlClip's word timings: within each source segment it drops filler tokens and
// splits around long pauses, emitting tighter sub-segments. The renderer already
// concatenates multiple segments per clip and buildAss remaps their times, so no
// render change is needed. Hard cuts (like Opus) — expect the occasional jump cut.

import type { EdlClip, EdlSegment } from "@/lib/video/edl";
import type { TranscriptWord } from "@/lib/video/transcribe";

// Conservative single-token fillers only — avoids butchering meaningful words.
const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "er", "err", "erm", "ah", "ahh", "hmm", "mmm", "mm"]);
const GAP_MS = 600; // pause longer than this is treated as dead air and cut
const PAD_MS = 80; // keep a little breath around each cut so speech isn't clipped
const MIN_SEG_MS = 400; // drop slivers

const normalize = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");

/** Return the clip with filler words and long pauses removed. Never returns an
 *  empty clip — if tightening would remove everything, the original is kept. */
export function tightenClip(clip: EdlClip, words: TranscriptWord[]): EdlClip {
  const result: EdlSegment[] = [];

  for (const seg of clip.segments) {
    const segWords = words
      .filter((w) => w.endMs > seg.startMs && w.startMs < seg.endMs)
      .map((w) => ({
        startMs: Math.max(w.startMs, seg.startMs),
        endMs: Math.min(w.endMs, seg.endMs),
        text: normalize(w.text),
      }))
      .filter((w) => w.endMs > w.startMs);

    // No speech (music / action) — keep the segment untouched.
    if (!segWords.length) {
      result.push(seg);
      continue;
    }

    // Build runs of consecutive spoken words. A filler word or a pause > GAP_MS
    // closes the current run — so the filler's own time span is excluded, not
    // just skipped over (that was the bug: mid-sentence "um" stayed in).
    const runs: EdlSegment[] = [];
    let start: number | null = null;
    let end = 0;
    const close = () => {
      if (start !== null && end > start) runs.push({ startMs: start, endMs: end });
      start = null;
    };
    for (const w of segWords) {
      if (!w.text || FILLERS.has(w.text)) {
        close();
        continue;
      }
      if (start === null) {
        start = w.startMs;
        end = w.endMs;
      } else if (w.startMs - end > GAP_MS) {
        close();
        start = w.startMs;
        end = w.endMs;
      } else {
        end = w.endMs;
      }
    }
    close();

    if (!runs.length) {
      result.push(seg); // all filler / silence — keep the original honestly
      continue;
    }

    // Pad + clamp to the segment, prevent overlap between runs, drop slivers.
    // Sub-segments inherit the parent's fields (source, effect, speed); the
    // transition only enters with the FIRST sub-segment — the rest are cuts.
    let prevEnd = seg.startMs;
    let first = true;
    for (const r of runs) {
      const s = Math.max(seg.startMs, prevEnd, r.startMs - PAD_MS);
      const e = Math.min(seg.endMs, r.endMs + PAD_MS);
      if (e - s >= MIN_SEG_MS) {
        result.push({ ...seg, startMs: s, endMs: e, transition: first ? seg.transition : "cut" });
        prevEnd = e;
        first = false;
      }
    }
  }

  if (!result.length) return clip; // tightening ate everything — keep the original honestly
  return { ...clip, segments: result };
}
