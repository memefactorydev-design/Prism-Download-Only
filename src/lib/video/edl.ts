// Edit Decision List planning. Claude is the creative director here: given the
// timestamped transcript and the research agents' ranked viral hooks, it returns
// a structured EDL — which source segments to keep, the hook, the caption — for
// each clip. The worker's renderer (render.ts) executes that EDL with ffmpeg.
//
// Counts are adaptive caps, never quotas: the agent is told the source length and
// the maximum, and instructed to return only genuinely strong standalone moments
// (the "never fake success" guardrail — no filler clips to hit a number).
//
// When no AI engine is ready, a clearly-labelled heuristic fallback still
// produces an EDL so the render pipeline can be exercised end-to-end locally.

import type { AdIdea, TrendInsight } from "@prisma/client";
import { runAgent } from "@/lib/agents/run-agent";
import { toSegments, type Transcript } from "@/lib/video/transcribe";

// Compact "what's trending" block woven into the edit prompts so reels/montages
// reflect current TikTok/Instagram patterns (from the trend-research agents).
function trendBlock(trends: TrendInsight[]): string {
  if (!trends.length) return "";
  return [
    "",
    "## Current trending patterns on TikTok/Instagram (apply these where they fit)",
    ...trends.map(
      (t) =>
        `- [${t.platform}] ${t.title}: hook "${t.hook}" — ${t.format}` +
        `${t.pacing ? `; pacing: ${t.pacing}` : ""}${t.sound ? `; sound: ${t.sound}` : ""}`
    ),
  ].join("\n");
}

export type ClipKind = "reel" | "ad" | "podcast";

// On-screen effect ids live in the pure module (web-bundle-safe); re-exported
// here so pipeline code keeps one import site.
export { SEGMENT_EFFECTS } from "@/lib/video/effects";
export type { SegmentEffect } from "@/lib/video/effects";
import type { SegmentEffect } from "@/lib/video/effects";
import { normalizeSpeed, normalizeTransition, type SegmentTransition } from "@/lib/video/transitions";

export interface EdlSegment {
  startMs: number;
  endMs: number;
  sourceIndex?: number; // which montage source this is from; absent/0 for single-source
  effect?: SegmentEffect; // optional on-screen effect for this segment
  speed?: number; // playback rate (SEGMENT_SPEEDS); ≠1 mutes the segment's own audio
  transition?: SegmentTransition; // how this segment ENTERS (first is always "cut")
}

export interface EdlClip {
  rank: number;
  title: string;
  hook: string; // first 2-3 seconds, written out
  caption: string; // suggested caption + hashtags
  segments: EdlSegment[]; // source ranges, concatenated in order
  cta?: string; // ads only
  adIdeaRank?: number; // which provided AdIdea inspired it, if any
  viralityScore?: number; // 0-100 predicted-performance estimate (D2)
  viralityRationale?: string; // why (D2)
  keywords?: string[]; // words to emphasise in captions (D2)
  emojiHints?: { word: string; emoji: string }[]; // emoji pops over the caption when the word is spoken
}

export interface PlanResult {
  clips: EdlClip[];
  reportMarkdown: string;
  planner: "claude" | "fallback";
}

export const REEL_CAP = 50;

// No minItems/maxItems/minLength — those constraints aren't supported here
// (see src/lib/research.ts). We validate counts/ordering after parsing instead.
const CLIP_SCHEMA = {
  type: "object",
  properties: {
    reportMarkdown: {
      type: "string",
      description: "Short markdown summary of the editing decisions and why these moments were chosen.",
    },
    clips: {
      type: "array",
      description: "Strongest standalone moments, best first. Only include genuinely strong ones.",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer", description: "1 = strongest." },
          title: { type: "string", description: "Internal label for this clip." },
          hook: { type: "string", description: "The first 2-3 seconds, written out." },
          caption: { type: "string", description: "Suggested post caption including hashtags." },
          segments: {
            type: "array",
            description: "Source time ranges to keep, in playback order.",
            items: {
              type: "object",
              properties: {
                startMs: { type: "integer" },
                endMs: { type: "integer" },
                effect: {
                  type: "string",
                  enum: ["none", "punch_in", "zoom_drift", "flash_cut"],
                  description:
                    "On-screen effect: punch_in = fast zoom for hooks/reveals; zoom_drift = subtle slow zoom for atmosphere; flash_cut = white flash INTO this segment for a hard transition; none otherwise. Use sparingly — 1-2 per clip.",
                },
              },
              required: ["startMs", "endMs", "effect"],
              additionalProperties: false,
            },
          },
          adIdeaRank: {
            type: "integer",
            description: "Rank of the provided ad idea this draws on, or 0 if none.",
          },
          viralityScore: {
            type: "integer",
            description:
              "0-100 estimate of viral/engagement potential: hook strength, emotional peak, payoff, trend fit. Be discerning — reserve 80+ for genuinely exceptional moments.",
          },
          viralityRationale: {
            type: "string",
            description: "One sentence justifying the score.",
          },
          keywords: {
            type: "array",
            description: "2-5 punchy words from this clip to emphasise in the captions.",
            items: { type: "string" },
          },
          emojiHints: {
            type: "array",
            description:
              "0-4 emoji pops: each pairs ONE exact spoken word from the transcript with ONE fitting emoji, shown over the captions when the word is said. Use sparingly on emotional peaks; empty array if none fit.",
            items: {
              type: "object",
              properties: {
                word: { type: "string", description: "The exact spoken word (as it appears in the transcript)." },
                emoji: { type: "string", description: "A single emoji character." },
              },
              required: ["word", "emoji"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "rank",
          "title",
          "hook",
          "caption",
          "segments",
          "adIdeaRank",
          "viralityScore",
          "viralityRationale",
          "keywords",
          "emojiHints",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["reportMarkdown", "clips"],
  additionalProperties: false,
};

interface ClipPayload {
  reportMarkdown: string;
  clips: {
    rank: number;
    title: string;
    hook: string;
    caption: string;
    segments: { startMs: number; endMs: number; effect?: SegmentEffect }[];
    adIdeaRank: number;
    viralityScore: number;
    viralityRationale: string;
    keywords: string[];
    emojiHints: { word: string; emoji: string }[];
  }[];
}

/** Keep only well-formed, in-bounds segments; drop empty clips. Honest sanitation. */
function sanitize(clips: EdlClip[], durationMs: number): EdlClip[] {
  const cleaned: EdlClip[] = [];
  for (const clip of clips) {
    const segments = (clip.segments ?? [])
      .map((s) => ({
        startMs: Math.max(0, Math.min(s.startMs, durationMs)),
        endMs: Math.max(0, Math.min(s.endMs, durationMs)),
        effect: s.effect,
      }))
      .filter((s) => s.endMs - s.startMs >= 500); // ignore sub-half-second slivers
    if (segments.length) cleaned.push({ ...clip, segments });
  }
  // Rank by predicted virality (desc); fall back to the agent's own rank.
  return cleaned
    .sort((a, b) => (b.viralityScore ?? -1) - (a.viralityScore ?? -1) || a.rank - b.rank)
    .slice(0, REEL_CAP)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

// A viral template blueprint (from the Templates section) to steer the edit.
function blueprintBlock(blueprint?: string | null): string {
  if (!blueprint?.trim()) return "";
  return [
    "",
    "## Template blueprint to follow (the user picked this viral template — match its structure)",
    "Shape each reel to this recipe: use its hook style, segment/beat sequence, pacing, and on-screen-text moments. Still only keep genuinely strong moments from THIS source; adapt the blueprint to the footage rather than inventing content that isn't there.",
    blueprint.trim().slice(0, 4000),
  ].join("\n");
}

export async function planReels(
  transcript: Transcript,
  ideas: AdIdea[],
  durationSecs: number,
  trends: TrendInsight[] = [],
  blueprint?: string | null,
  templateTitle?: string | null,
  scopeUserId = "" // the owning job's scope — members' plans use THEIR brand
): Promise<PlanResult> {
  const durationMs = Math.round(durationSecs * 1000);
  const lines = toSegments(transcript.words);
  const compactTranscript = lines
    .map((l) => `[${(l.startMs / 1000).toFixed(1)}s-${(l.endMs / 1000).toFixed(1)}s] ${l.text}`)
    .join("\n");

  const ideaBlock = ideas.length
    ? ideas
        .map((i) => `#${i.rank} ${i.title} — hook: "${i.hook}" (${i.format}; ${i.brandAngle ?? ""})`)
        .join("\n")
    : "No ranked ad ideas available yet — use your own judgement on what makes a strong hook.";

  const minutes = Math.round(durationSecs / 60);
  // Duration-aware cap: ~1 clip per 40s of source, so a short video doesn't push
  // the model to emit dozens of clips (which blows the output token budget).
  const maxClips = Math.min(REEL_CAP, Math.max(3, Math.ceil(durationSecs / 40)));
  const task = [
    `You are editing a ${minutes}-minute ( ${Math.round(durationSecs)}s ) source video into vertical short-form reels for Instagram and TikTok.`,
    "",
    "Pick the strongest STANDALONE moments — each must make sense on its own, open with a scroll-stopping hook, and run roughly 15-60 seconds (one or a few contiguous source segments).",
    `Return AT MOST ${maxClips}, but only genuinely strong ones — fewer great clips beats padding to a number. A short source may only yield a handful.`,
    "",
    "## the brand's researched viral hooks (use as inspiration where they fit)",
    ideaBlock,
    trendBlock(trends),
    blueprintBlock(blueprint),
    "",
    "## Transcript with source timestamps (use these exact times for segments)",
    compactTranscript.slice(0, 45_000),
    "",
    "For each clip give: rank (1=best), an internal title, the hook (first 2-3s written out), a ready-to-post caption with hashtags, the source segment time ranges in milliseconds, a viralityScore (0-100) with a one-line viralityRationale, and 2-5 keywords to emphasise in the captions. Set adIdeaRank to the # of the ad idea you drew on, or 0.",
    "Also give emojiHints: up to 4 {word, emoji} pairs — each word must be an exact spoken word from the transcript; its emoji pops on screen as the word is said. Save them for emotional peaks (reveals, numbers, punchlines); an empty array is better than forced emojis.",
    "Each segment carries an effect: punch_in for the hook or a reveal, zoom_drift for a calm atmospheric hold, flash_cut when jumping between non-contiguous moments, none otherwise. 1-2 effects per clip maximum — restraint reads as premium.",
  ].join("\n");

  const { data } = await runAgent<ClipPayload>("video-editor-agent", task, {
    schema: CLIP_SCHEMA,
    // Multi-clip structured plans are large and adaptive thinking eats into the
    // budget; give big headroom (thinking + output) so it doesn't truncate.
    maxTokens: 64000,
    reportKind: "video_production",
    reportTitle: templateTitle
      ? `Reel edit plan (${minutes} min source · template: ${templateTitle})`
      : `Reel edit plan (${minutes} min source)`,
    scopeUserId,
  });
  if (!data) throw new Error("video-editor-agent returned no structured plan.");

  const clips = sanitize(
    data.clips.map((c) => ({
      rank: c.rank,
      title: c.title,
      hook: c.hook,
      caption: c.caption,
      segments: c.segments,
      adIdeaRank: c.adIdeaRank || undefined,
      viralityScore: c.viralityScore,
      viralityRationale: c.viralityRationale,
      keywords: c.keywords,
      emojiHints: c.emojiHints,
    })),
    durationMs
  );
  return { clips, reportMarkdown: data.reportMarkdown, planner: "claude" };
}

/**
 * Heuristic planner used when no AI engine is ready. Splits the transcript on
 * natural pauses into ~30s windows so the render path is fully testable offline.
 * Clearly labelled as a fallback — it does not rank by engagement.
 */
export function fallbackReels(transcript: Transcript): PlanResult {
  const TARGET_MS = 30_000;
  const MIN_MS = 12_000;
  const lines = toSegments(transcript.words, 6_000, 900);
  const clips: EdlClip[] = [];
  let startMs = lines[0]?.startMs ?? 0;
  let lastEnd = startMs;

  const push = (s: number, e: number) => {
    if (e - s < MIN_MS) return;
    const n = clips.length + 1;
    const words = transcript.words.filter((w) => w.startMs >= s && w.endMs <= e);
    const opening = words.slice(0, 8).map((w) => w.text).join(" ");
    clips.push({
      rank: n,
      title: `Clip ${n} (fallback)`,
      hook: opening || `Moment at ${Math.round(s / 1000)}s`,
      caption: opening ? `${opening}…` : "",
      segments: [{ startMs: s, endMs: e }],
    });
  };

  for (const l of lines) {
    if (l.endMs - startMs >= TARGET_MS) {
      push(startMs, lastEnd);
      startMs = l.startMs;
    }
    lastEnd = l.endMs;
    if (clips.length >= REEL_CAP) break;
  }
  push(startMs, lastEnd);

  return {
    clips: clips.slice(0, REEL_CAP),
    reportMarkdown:
      "**Fallback planner** (no AI engine ready): clips are evenly split on natural pauses, not ranked by predicted engagement. Sign in to Claude Code or Codex, or add an API key on the Connections page, for hook-driven, research-informed editing.",
    planner: "fallback",
  };
}

// ─── Montage (multi-source) planning ────────────────────────────────────────

export interface MontageSource {
  index: number;
  filename: string;
  transcript: Transcript;
  durationSecs: number;
}

// Same clip schema as single, but each segment also names its source. Cloned so
// the single-source CLIP_SCHEMA stays untouched.
const MONTAGE_CLIP_SCHEMA = (() => {
  const s = structuredClone(CLIP_SCHEMA) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seg = (s as any).properties.clips.items.properties.segments.items;
  seg.properties.sourceIndex = {
    type: "integer",
    description: "Which source video this segment comes from (0-based).",
  };
  seg.properties.speed = {
    type: "number",
    enum: [0.25, 0.5, 0.75, 1, 1.5, 2],
    description:
      "Playback speed: 1 = normal. 0.5/0.25 = a deliberate slow-mo beat (impact, reveal, texture) — slowed segments play SILENT, so never slow speech, and never the opening hook. 1.5/2 = compress action. A ramp = 2-3 consecutive segments at stepped speeds (1 → 0.5 → 1). Slow-mo consumes footage: a 0.5x segment needs twice its source span.",
  };
  seg.properties.transition = {
    type: "string",
    enum: ["cut", "dissolve", "morph"],
    description:
      "How this segment ENTERS: cut = hard cut (the default, and correct ~90% of the time); dissolve = free ~0.6s crossfade to soften a scene change; morph = an AI-generated ~1.3s bridge that transforms the previous shot's last frame into this shot's first frame — it costs a real render (~$1), so only between genuinely different subjects/locations where the transformation IS the moment. The first segment is always cut.",
  };
  seg.required = ["sourceIndex", "startMs", "endMs", "speed", "transition"];
  return s;
})();

interface MontageClipPayload {
  reportMarkdown: string;
  clips: {
    rank: number;
    title: string;
    hook: string;
    caption: string;
    segments: {
      sourceIndex: number;
      startMs: number;
      endMs: number;
      effect?: SegmentEffect;
      speed?: number;
      transition?: SegmentTransition;
    }[];
    adIdeaRank: number;
    viralityScore: number;
    viralityRationale: string;
    keywords: string[];
    emojiHints: { word: string; emoji: string }[];
  }[];
}

// Like sanitize(), but clamps each segment to ITS source's duration, snaps
// speed/transition to the allowed vocabulary, forces the first segment to
// enter on a cut, and caps morphs at 2 per clip (extras downgrade to
// dissolve — taste is prompted, the invoice is enforced).
function sanitizeMontage(clips: EdlClip[], durationsMs: number[]): EdlClip[] {
  const cleaned: EdlClip[] = [];
  for (const clip of clips) {
    let morphs = 0;
    const segments = (clip.segments ?? [])
      .map((s) => {
        const idx = Math.max(0, Math.min(s.sourceIndex ?? 0, durationsMs.length - 1));
        const dur = durationsMs[idx] ?? 0;
        return {
          sourceIndex: idx,
          startMs: Math.max(0, Math.min(s.startMs, dur)),
          endMs: Math.max(0, Math.min(s.endMs, dur)),
          effect: s.effect,
          speed: normalizeSpeed(s.speed),
          transition: normalizeTransition(s.transition),
        };
      })
      .filter((s) => s.endMs - s.startMs >= 500)
      .map((s, i) => {
        if (i === 0) return { ...s, transition: "cut" as const };
        if (s.transition === "morph" && ++morphs > 2) return { ...s, transition: "dissolve" as const };
        return s;
      });
    if (segments.length) cleaned.push({ ...clip, segments });
  }
  return cleaned
    .sort((a, b) => (b.viralityScore ?? -1) - (a.viralityScore ?? -1) || a.rank - b.rank)
    .slice(0, REEL_CAP)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

export async function planMontage(
  sources: MontageSource[],
  ideas: AdIdea[],
  trends: TrendInsight[] = [],
  opts: { trailer?: boolean; morphs?: boolean } = {},
  scopeUserId = "" // the owning job's scope — members' plans use THEIR brand
): Promise<PlanResult> {
  const totalSecs = sources.reduce((a, s) => a + s.durationSecs, 0);
  const maxClips = Math.min(REEL_CAP, Math.max(3, Math.ceil(totalSecs / 40)));

  const sourceBlocks = sources
    .map((s) => {
      const lines = toSegments(s.transcript.words)
        .map((l) => `[${(l.startMs / 1000).toFixed(1)}s-${(l.endMs / 1000).toFixed(1)}s] ${l.text}`)
        .join("\n");
      return `=== Source ${s.index}: ${s.filename} (${Math.round(s.durationSecs)}s) ===\n${lines.slice(0, 22_000)}`;
    })
    .join("\n\n");

  const ideaBlock = ideas.length
    ? ideas.map((i) => `#${i.rank} ${i.title} — hook: "${i.hook}" (${i.format}; ${i.brandAngle ?? ""})`).join("\n")
    : "No ranked ad ideas available yet — use your own judgement on what makes a strong hook.";

  const trailerLines = opts.trailer
    ? [
        "TRAILER MODE: these reels play over a MUSIC track with the original audio muted — do NOT rely on spoken punchlines. Choose the most striking VISUAL beats, cut fast (roughly 1.5-3s per segment), escalate the energy, and build to a strong climax. Captions may be off, so the visuals must carry it.",
        "You may SPEED-RAMP: mark a shot 0.5 (or 0.25 for the single biggest money shot) so its impact lands on the drop — at most 2 ramps per 30 seconds, never the opening shot, and slowed shots consume proportionally more source footage (a 0.5 segment needs twice its span). For a ramp FEEL, split one moment into 2-3 consecutive segments at stepped speeds (1 → 0.5 → 1). Use 1.5/2 to compress slow action.",
      ]
    : [
        "Pull the strongest STANDALONE moments and MIX them across sources where combining makes a tighter hook or story — a fast-cut supercut. A reel may stitch segments from several sources; keep a single-source reel only when that is genuinely stronger.",
        "Speed: only change speed on segments WITHOUT speech (slowed/sped segments play silent). 0.5/0.25 for a visual money shot, 1.5/2 to compress action; at most 2 ramps per 30 seconds.",
      ];
  const transitionLine = opts.morphs
    ? "Transitions: 'cut' is the default and correct ~90% of the time; 'dissolve' softens a genuine change of place or subject; 'morph' is an AI-generated bridge (~$1 each, max 2 per reel) ONLY where the reel jumps between genuinely different subjects/locations and the transformation itself is the wow. Never pair morph with flash_cut; the first segment is always cut."
    : "Transitions: 'cut' is the default and correct ~90% of the time; 'dissolve' softens a genuine change of place or subject. AI morph bridges are not available for this job — never use 'morph'.";
  const task = [
    `You are editing ${sources.length} source videos into vertical short-form MONTAGE reels for Instagram and TikTok.`,
    "",
    ...trailerLines,
    transitionLine,
    "Each segment MUST give sourceIndex (which source, 0-based) plus startMs/endMs IN THAT SOURCE'S OWN timeline, a speed, and a transition.",
    `Return AT MOST ${maxClips}, only genuinely strong ones. Each reel ~15-60 seconds total.`,
    "If the sources are short and already well-cut, it is good to use whole clips and stitch them together. ALWAYS return at least one reel that combines the provided videos — never return an empty list.",
    "",
    "## the brand's researched viral hooks (inspiration where they fit)",
    ideaBlock,
    trendBlock(trends),
    "",
    "## Sources with per-source timestamps",
    sourceBlocks,
    "",
    "For each clip give: rank (1=best), title, hook (first 2-3s), a ready-to-post caption with hashtags, segments as [{sourceIndex,startMs,endMs}], a viralityScore (0-100) + one-line viralityRationale, 2-5 keywords, and adIdeaRank (or 0).",
  ].join("\n");

  const { data } = await runAgent<MontageClipPayload>("video-editor-agent", task, {
    schema: MONTAGE_CLIP_SCHEMA,
    maxTokens: 64000,
    reportKind: "video_production",
    reportTitle: `Montage plan (${sources.length} sources)`,
    scopeUserId,
  });
  if (!data) throw new Error("video-editor-agent returned no montage plan.");

  const durationsMs = sources.map((s) => Math.round(s.durationSecs * 1000));
  const clips = sanitizeMontage(
    data.clips.map((c) => ({
      rank: c.rank,
      title: c.title,
      hook: c.hook,
      caption: c.caption,
      segments: c.segments,
      adIdeaRank: c.adIdeaRank || undefined,
      viralityScore: c.viralityScore,
      viralityRationale: c.viralityRationale,
      keywords: c.keywords,
      emojiHints: c.emojiHints,
    })),
    durationsMs
  );
  return { clips, reportMarkdown: data.reportMarkdown, planner: "claude" };
}

/** Heuristic montage when no AI engine is ready: a supercut of each source's
 *  opening ~15s, so the multi-source render path is testable offline. */
export function fallbackMontage(sources: MontageSource[]): PlanResult {
  const PER_MS = 15_000;
  const segments = sources
    .map((s) => {
      const start = s.transcript.words[0]?.startMs ?? 0;
      return {
        sourceIndex: s.index,
        startMs: start,
        endMs: Math.min(start + PER_MS, Math.round(s.durationSecs * 1000)),
      };
    })
    .filter((s) => s.endMs - s.startMs >= 3_000);
  const clips: EdlClip[] = segments.length
    ? [{ rank: 1, title: "Montage 1 (fallback)", hook: "", caption: "", segments }]
    : [];
  return {
    clips,
    reportMarkdown:
      "**Fallback montage** (no AI engine ready): a simple supercut of each video's opening, not ranked by engagement. Set up an AI engine on the Connections page for hook-driven cross-source mixing.",
    planner: "fallback",
  };
}
