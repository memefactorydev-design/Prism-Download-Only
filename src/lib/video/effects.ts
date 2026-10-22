// Segment effect ids — DATA ONLY (no ffmpeg/ML imports), safe for the web
// bundle. The filter implementations live in render.ts (worker-side).
// All effects are duration-preserving overlays. Time-CHANGING treatments
// (speed ramps, morph/dissolve bridges) are a separate axis — see
// transitions.ts + timeline.ts: every consumer maps source→output time through
// the one shared timeline model, so retiming can't drift captions/SFX/beat.

export const SEGMENT_EFFECTS = ["none", "punch_in", "zoom_drift", "flash_cut"] as const;
export type SegmentEffect = (typeof SEGMENT_EFFECTS)[number];
