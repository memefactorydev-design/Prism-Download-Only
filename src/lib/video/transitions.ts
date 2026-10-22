// Speed + transition vocabulary for segments/scenes. Data-only and
// web-bundle-safe (like effects.ts) — planner schemas, sanitizers, the
// timeline model and UI copy all read from here so semantics can't drift.
//
// Speed: playback rate for a segment. Any speed ≠ 1 MUTES that segment's own
// audio (sanitizer-enforced) — the music bed or voice-over carries slowed
// beats, so no atempo/pitch artifacts ever ship. A "speed ramp" is expressed
// by splitting a moment into 2-3 consecutive segments at stepped speeds
// (1 → 0.5 → 1); no intra-segment keyframes.
//
// Transition: how a segment ENTERS from the previous one (first is always a
// cut). "dissolve" is a free ffmpeg still-crossfade bridge; "morph" is an
// AI-generated Seedance bridge (prev last frame → next first frame) — it
// costs a real render (~$1), so caps below are enforced by downgrade.

export const SEGMENT_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;
export type SegmentSpeed = (typeof SEGMENT_SPEEDS)[number];

export const SEGMENT_TRANSITIONS = ["cut", "dissolve", "morph"] as const;
export type SegmentTransition = (typeof SEGMENT_TRANSITIONS)[number];

/** Bridge length on the OUTPUT timeline (a 4s Seedance render plays at ~3.1x). */
export const MORPH_BRIDGE_OUT_MS = 1300;
/** The free fallback bridge: a still-to-still crossfade. */
export const DISSOLVE_BRIDGE_OUT_MS = 600;

/** Hard spend caps — extras are downgraded (morph→dissolve), never a failure. */
export const MORPH_MAX_PER_RENDER = 3; // one Director cut / one ad film
export const MORPH_MAX_PER_JOB = 4; // a whole montage job (rank-first)

/** Photo sources in the Director animate into this much live footage — the
 *  window scene trims cut within. One i2v render per (photo, motion) pair. */
export const PHOTO_ANIMATE_MS = 8_000;

/** UI/prompt cost estimate for one Seedance bridge (4s · 720p · no audio). */
export const MORPH_BRIDGE_EST_USD = 1;

/** Snap an agent-supplied speed to the nearest allowed value; default 1. */
export function normalizeSpeed(v: unknown): SegmentSpeed {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 1;
  let best: SegmentSpeed = 1;
  let dist = Infinity;
  for (const s of SEGMENT_SPEEDS) {
    const d = Math.abs(s - n);
    if (d < dist) {
      dist = d;
      best = s;
    }
  }
  return best;
}

/** Validate an agent-supplied transition; default "cut". */
export function normalizeTransition(v: unknown): SegmentTransition {
  return SEGMENT_TRANSITIONS.includes(v as SegmentTransition) ? (v as SegmentTransition) : "cut";
}
