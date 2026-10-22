// Director (codename "fable") — the conversational AI video editor's core:
// the FablePlan document (a project's working state, like Page.html in the site
// builder), its structured-output schema, the post-parse sanitizer, the
// FablePlan → EdlClip converter (so the render pipeline's caption/emoji/SFX
// machinery runs unmodified), and the director-agent task builder.
//
// Deliberately light: no ffmpeg/ML imports — safe for API routes. The heavy
// execution lives in src/worker/process-fable.ts.

import type { AdIdea, ContentTemplate, FableSource, TrendInsight } from "@prisma/client";
import { CAPTION_STYLE_IDS, DEFAULT_CAPTION_STYLE } from "@/lib/video/caption-styles";
import { SEGMENT_EFFECTS, type SegmentEffect } from "@/lib/video/effects";
import {
  MORPH_BRIDGE_OUT_MS,
  PHOTO_ANIMATE_MS,
  normalizeSpeed,
  normalizeTransition,
  type SegmentTransition,
} from "@/lib/video/transitions";
// Type-only imports are erased at compile time — transcribe.ts/edl.ts pull
// ffmpeg/ML deps and must never enter the Next bundle as values.
import type { EdlClip } from "@/lib/video/edl";
import type { Transcript, TranscriptWord } from "@/lib/video/transcribe";

// Local sentence-line digest (pure twin of transcribe.ts's toSegments, kept
// here so this module stays web-bundle-safe).
function digestLines(words: TranscriptWord[], maxLineMs = 5_000, gapMs = 700): { startMs: number; endMs: number; text: string }[] {
  const lines: { startMs: number; endMs: number; text: string }[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({ startMs: cur[0].startMs, endMs: cur[cur.length - 1].endMs, text: cur.map((w) => w.text).join(" ") });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const span = w.endMs - cur[0].startMs;
      const gap = w.startMs - cur[cur.length - 1].endMs;
      if (span > maxLineMs || gap > gapMs) flush();
    }
    cur.push(w);
  }
  flush();
  return lines;
}

// ─── Plan types ──────────────────────────────────────────────────────────────

export interface FableScene {
  sourceIndex: number; // into FableSource.index
  startMs: number; // source-time
  endMs: number;
  effect: SegmentEffect;
  audio: "dialogue" | "mute"; // keep this scene's own sound vs silent (under VO/music)
  captionNote: string; // director intent, storyboard display only ("" if none)
  speed: number; // playback rate (SEGMENT_SPEEDS); ≠1 forces audio "mute"
  transition: SegmentTransition; // how this scene ENTERS (scene 0 is always "cut")
  motion: string; // photo sources only: how the still comes alive ("" for video sources)
}

export interface FablePlan {
  version: 1;
  title: string;
  summary: string; // 1-2 sentences: what the cut is / what changed this turn (the chat bubble)
  hook: string;
  postCaption: string; // ready-to-post caption + hashtags
  targetDurationMs: number;
  aspect: "9:16"; // fixed v1; field reserved
  captions: boolean;
  captionStyle: string;
  keywords: string[];
  emojiHints: { word: string; emoji: string }[];
  scenes: FableScene[]; // ordered = the output timeline
  music: {
    mode: "none" | "search" | "asset";
    query: string; // Eleven Music vibe prompt when mode "search" ("" otherwise)
    assetId: string; // resolved MediaAsset when mode "asset" ("" otherwise)
    beatSync: boolean;
    beatCadence: number; // 1 | 2 | 4
  };
  voiceover: {
    enabled: boolean;
    script: string; // read aloud verbatim ("" when disabled)
    voiceId: string; // ElevenLabs voice id ("" = connection default)
  };
  sfxIntensity: "off" | "subtle" | "punchy";
}

// ─── Structured-output schema ────────────────────────────────────────────────
// All fields required (structured outputs don't support optional-with-default);
// no minItems/maxLength constraints (unsupported) — sanitizeFablePlan validates.

export const FABLE_PLAN_SCHEMA = {
  type: "object",
  properties: {
    version: { type: "integer", description: "Always 1." },
    title: { type: "string", description: "Short name for this cut." },
    summary: {
      type: "string",
      description:
        "1-2 conversational sentences to the owner: what the cut is, or what you changed this turn (this is your chat reply).",
    },
    hook: { type: "string", description: "The first seconds' hook, written out." },
    postCaption: { type: "string", description: "Ready-to-post caption including hashtags." },
    targetDurationMs: { type: "integer", description: "Total output length in ms (8000-90000)." },
    aspect: { type: "string", enum: ["9:16"] },
    captions: { type: "boolean", description: "Burn word-synced captions." },
    captionStyle: { type: "string", description: "One of the available caption style ids." },
    keywords: { type: "array", items: { type: "string" }, description: "2-5 words to emphasise in captions." },
    emojiHints: {
      type: "array",
      description:
        "0-4 emoji pops: ONE exact spoken/narrated word + ONE emoji each, shown as the word is said. Empty array if none fit.",
      items: {
        type: "object",
        properties: { word: { type: "string" }, emoji: { type: "string" } },
        required: ["word", "emoji"],
        additionalProperties: false,
      },
    },
    scenes: {
      type: "array",
      description: "The output timeline, in playback order. Source time ranges in ms.",
      items: {
        type: "object",
        properties: {
          sourceIndex: { type: "integer", description: "Which source video (0-based index as listed)." },
          startMs: { type: "integer" },
          endMs: { type: "integer" },
          effect: {
            type: "string",
            enum: ["none", "punch_in", "zoom_drift", "flash_cut"],
            description: "punch_in for hooks/reveals, zoom_drift for calm holds, flash_cut for hard jumps. 1-2 per cut max.",
          },
          audio: {
            type: "string",
            enum: ["dialogue", "mute"],
            description: "Keep this scene's own sound, or mute it (b-roll under voice-over/music).",
          },
          captionNote: { type: "string", description: "One-line intent note for the storyboard ('' if none)." },
          speed: {
            type: "number",
            enum: [0.25, 0.5, 0.75, 1, 1.5, 2],
            description:
              "Playback speed. 1 = normal. 0.5 = a deliberate slow-mo beat (impact/reveal); 0.25 = the single biggest money shot only. 1.5/2 = compress action. Slowed/sped scenes are MUTED automatically — never slow dialogue or the hook; keep slow beats short (1-3s of output). A ramp = split the moment into 2-3 consecutive scenes at stepped speeds.",
          },
          transition: {
            type: "string",
            enum: ["cut", "dissolve", "morph"],
            description:
              "How this scene ENTERS from the previous one. cut = hard cut (default). dissolve = free ~0.6s crossfade for a soft scene change. morph = an AI-generated ~1.3s bridge that transforms the previous scene's last frame into this scene's first frame (~$1 per bridge, max 2 per cut) — only between genuinely different subjects/locations, never scene 1, never with flash_cut.",
          },
          motion: {
            type: "string",
            description:
              "PHOTO sources only: one sentence directing how the still comes alive (camera move + what stirs, e.g. 'slow push-in as steam rises and light shifts across the marble'). '' for video sources.",
          },
        },
        required: ["sourceIndex", "startMs", "endMs", "effect", "audio", "captionNote", "speed", "transition", "motion"],
        additionalProperties: false,
      },
    },
    music: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["none", "search", "asset"] },
        query: {
          type: "string",
          description: "Eleven Music vibe prompt when mode='search' — vibe + genre + tempo, e.g. 'warm acoustic uplifting 100bpm'. An original track is composed to fit the cut. '' otherwise.",
        },
        assetId: { type: "string", description: "Existing MediaAsset id when mode='asset'; '' otherwise. NEVER invent ids." },
        beatSync: { type: "boolean", description: "Snap cuts to the music's beat (needs music)." },
        beatCadence: { type: "integer", description: "Beats per cut: 1 fast, 2 punchy, 4 smooth." },
      },
      required: ["mode", "query", "assetId", "beatSync", "beatCadence"],
      additionalProperties: false,
    },
    voiceover: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        script: {
          type: "string",
          description:
            "The narration, read aloud verbatim — plain prose, ~2.3 words/second, sized to fit UNDER the timeline length. '' when disabled.",
        },
        voiceId: { type: "string", description: "An available ElevenLabs voice id, or '' for the default narrator." },
      },
      required: ["enabled", "script", "voiceId"],
      additionalProperties: false,
    },
    sfxIntensity: { type: "string", enum: ["off", "subtle", "punchy"] },
  },
  required: [
    "version",
    "title",
    "summary",
    "hook",
    "postCaption",
    "targetDurationMs",
    "aspect",
    "captions",
    "captionStyle",
    "keywords",
    "emojiHints",
    "scenes",
    "music",
    "voiceover",
    "sfxIntensity",
  ],
  additionalProperties: false,
};

// ─── Sanitizer ───────────────────────────────────────────────────────────────

const MAX_SCENES = 30;
const MIN_DURATION_MS = 8_000;
const MAX_DURATION_MS = 90_000;

/**
 * Validate + clamp a parsed plan against the project's real sources. Throws on
 * unrecoverable emptiness (no usable scenes); silently clamps everything else —
 * the plan must always be executable by ffmpeg.
 */
export function sanitizeFablePlan(plan: FablePlan, sources: FableSource[], photoIndices?: Set<number>): FablePlan {
  const durations = new Map(sources.map((s) => [s.index, Math.round((s.durationSecs ?? 0) * 1000)]));
  const scenes: FableScene[] = [];
  for (const s of plan.scenes ?? []) {
    const isPhoto = photoIndices?.has(s.sourceIndex) ?? false;
    const dur = isPhoto ? PHOTO_ANIMATE_MS : durations.get(s.sourceIndex);
    if (dur === undefined) continue; // unknown source index — drop
    const startMs = Math.max(0, Math.min(Math.round(s.startMs), dur));
    const endMs = Math.max(0, Math.min(Math.round(s.endMs), dur));
    if (endMs - startMs < 500) continue; // sub-half-second sliver
    const speed = normalizeSpeed(s.speed);
    let transition = normalizeTransition(s.transition);
    if (scenes.length === 0) transition = "cut"; // the first scene can't "enter"
    scenes.push({
      sourceIndex: s.sourceIndex,
      startMs,
      endMs,
      effect: (SEGMENT_EFFECTS as readonly string[]).includes(s.effect) ? s.effect : "none",
      // Speed ≠ 1 forces mute: retimed dialogue is never shipped — the music
      // bed / voice-over carries slowed beats. Animated photos are always
      // muted: their engine-generated audio is never part of the design.
      audio: s.audio === "mute" || speed !== 1 || isPhoto ? "mute" : "dialogue",
      captionNote: (s.captionNote ?? "").slice(0, 200),
      speed,
      transition,
      // Photo scenes always carry a motion direction (fallback keeps renders
      // deterministic when the agent leaves it empty).
      motion: isPhoto
        ? ((s.motion ?? "").trim() || "subtle cinematic camera drift with gentle natural movement").slice(0, 300)
        : "",
    });
    if (scenes.length >= MAX_SCENES) break;
  }
  // Cap morph spend by downgrade (earliest morphs win), never by failure.
  let morphs = 0;
  for (const sc of scenes) {
    if (sc.transition === "morph" && ++morphs > 2) sc.transition = "dissolve";
  }
  if (!scenes.length) {
    throw new Error("The plan has no usable scenes — every time range fell outside the footage.");
  }

  const music = plan.music ?? { mode: "none", query: "", assetId: "", beatSync: false, beatCadence: 2 };
  const musicMode = ["none", "search", "asset"].includes(music.mode) ? music.mode : "none";
  const voiceover = plan.voiceover ?? { enabled: false, script: "", voiceId: "" };

  return {
    version: 1,
    title: (plan.title || "Untitled cut").slice(0, 120),
    summary: (plan.summary || "Updated the plan.").slice(0, 600),
    hook: (plan.hook ?? "").slice(0, 300),
    postCaption: (plan.postCaption ?? "").slice(0, 2200),
    targetDurationMs: Math.min(Math.max(Math.round(plan.targetDurationMs || 30_000), MIN_DURATION_MS), MAX_DURATION_MS),
    aspect: "9:16",
    captions: plan.captions !== false,
    captionStyle: CAPTION_STYLE_IDS.includes(plan.captionStyle) ? plan.captionStyle : DEFAULT_CAPTION_STYLE,
    keywords: (plan.keywords ?? []).filter((k) => typeof k === "string").slice(0, 8),
    emojiHints: (plan.emojiHints ?? [])
      .filter((h) => h?.word && h?.emoji)
      .slice(0, 4)
      .map((h) => ({ word: String(h.word), emoji: String(h.emoji) })),
    scenes,
    music: {
      mode: musicMode,
      query: musicMode === "search" ? (music.query ?? "").slice(0, 200) : "",
      assetId: musicMode === "asset" ? (music.assetId ?? "").slice(0, 64) : "",
      beatSync: musicMode !== "none" && Boolean(music.beatSync),
      beatCadence: [1, 2, 4].includes(music.beatCadence) ? music.beatCadence : 2,
    },
    voiceover: {
      enabled: Boolean(voiceover.enabled) && Boolean(voiceover.script?.trim()),
      script: (voiceover.script ?? "").trim().slice(0, 4000),
      voiceId: (voiceover.voiceId ?? "").slice(0, 64),
    },
    sfxIntensity: ["off", "subtle", "punchy"].includes(plan.sfxIntensity) ? plan.sfxIntensity : "subtle",
  };
}

// ─── Plan → EDL ──────────────────────────────────────────────────────────────

/** Map a FablePlan onto the render pipeline's EdlClip so buildAss /
 * buildEmojiOverlays / buildSfxEvents run unmodified. */
export function planToEdlClip(plan: FablePlan): EdlClip {
  return {
    rank: 1,
    title: plan.title,
    hook: plan.hook,
    caption: plan.postCaption,
    segments: plan.scenes.map((s) => ({
      sourceIndex: s.sourceIndex,
      startMs: s.startMs,
      endMs: s.endMs,
      effect: s.effect,
      speed: s.speed,
      transition: s.transition,
    })),
    keywords: plan.keywords,
    emojiHints: plan.emojiHints,
  };
}

/** Total OUTPUT timeline length in ms (before beat-sync adjustments):
 *  scene spans divided by their speed, plus the bridge time morphs add.
 *  Drives music-compose length and the VO-fit check, so both automatically
 *  account for speed ramps and morph bridges. */
export function planTimelineMs(plan: FablePlan): number {
  const scenesMs = plan.scenes.reduce((a, s) => a + Math.round((s.endMs - s.startMs) / (s.speed || 1)), 0);
  const bridgeMs = plan.scenes.filter((s) => s.transition === "morph").length * MORPH_BRIDGE_OUT_MS;
  return scenesMs + bridgeMs;
}

// ─── Director task ───────────────────────────────────────────────────────────

export interface DirectorContext {
  projectTitle: string;
  instruction: string;
  currentPlan: FablePlan | null;
  sources: (FableSource & { originalName: string; isPhoto?: boolean })[];
  trends: TrendInsight[];
  ideas: AdIdea[];
  templates: ContentTemplate[];
  voices: { id: string; name: string }[]; // [] when ElevenLabs isn't connected
  morphAvailable: boolean; // fal connected → AI morph bridges can be generated
}

/**
 * Build the director's task. Builder philosophy: NO conversation history —
 * the current plan is the state; each turn amends it and returns the COMPLETE
 * new plan.
 */
export function buildDirectorTask(ctx: DirectorContext): string {
  const sourceBlocks = ctx.sources.map((s) => {
    if (s.isPhoto) {
      return [
        `### Source ${s.index}: "${s.originalName}" — PHOTO`,
        `A still image. Scenes on it are ANIMATED into live footage (AI image-to-video): usable time range 0-${PHOTO_ANIMATE_MS}ms; set the scene's \`motion\` to direct how it comes alive. Each distinct motion on this photo costs ~$1-2 to animate (re-renders are cached) — mention animations you add in your summary.`,
      ].join("\n");
    }
    const durS = (s.durationSecs ?? 0).toFixed(1);
    let digest = "(silent footage / b-roll — no dialogue)";
    if (s.transcript) {
      try {
        const t = JSON.parse(s.transcript) as Transcript;
        if (t.words?.length) {
          digest = digestLines(t.words)
            .map((l) => `[${(l.startMs / 1000).toFixed(1)}s-${(l.endMs / 1000).toFixed(1)}s] ${l.text}`)
            .join("\n")
            .slice(0, 9_000);
        }
      } catch {
        /* keep the b-roll note */
      }
    }
    return [
      `### Source ${s.index}: "${s.originalName}" — ${durS}s, ${s.width ?? "?"}x${s.height ?? "?"}${s.hasAudio ? "" : ", no audio track"}`,
      digest,
    ].join("\n");
  });

  const trendBlock = ctx.trends.length
    ? ["## Current viral patterns (apply where they fit)", ...ctx.trends.map((t) => `- [${t.platform}] ${t.title}: hook "${t.hook}" — ${t.format}`)].join("\n")
    : "";
  const ideaBlock = ctx.ideas.length
    ? ["## The brand's ranked ad ideas (draw on these where relevant)", ...ctx.ideas.map((i) => `- #${i.rank} ${i.title} — hook: "${i.hook}" (${i.format})`)].join("\n")
    : "";
  const templateBlock = ctx.templates.length
    ? ["## Viral template blueprints available (borrow their structure if asked or fitting)", ...ctx.templates.map((t) => `- "${t.title}": ${t.blueprint.slice(0, 300)}…`)].join("\n")
    : "";
  const voiceBlock = ctx.voices.length
    ? `Available narrator voices: ${ctx.voices.map((v) => `${v.name} (${v.id})`).join(", ")}. Use '' for the default.`
    : "Voice list unavailable — set voiceover.voiceId to '' (default narrator).";

  return [
    ctx.currentPlan
      ? `The owner wants changes to the current cut. Apply their request, keep everything else intact, and return the COMPLETE updated plan.\n\n<current_plan>\n${JSON.stringify(ctx.currentPlan, null, 1)}\n</current_plan>`
      : `Design the first cut of "${ctx.projectTitle}" from scratch.`,
    "",
    `## Owner's request`,
    ctx.instruction,
    "",
    "## Footage (timestamped transcripts — use these EXACT source times for scenes)",
    ...sourceBlocks,
    "",
    trendBlock,
    ideaBlock,
    templateBlock,
    "",
    `Available caption styles: ${CAPTION_STYLE_IDS.join(", ")}.`,
    voiceBlock,
    ctx.morphAvailable
      ? "Speed & transitions are storytelling tools, not decoration: slow (0.5) or super-slow (0.25) a SHORT scene so a reveal or money shot lands — at most 2 ramps per cut, never the hook, and slowed scenes are muted (dialogue stays at speed 1). When the owner says 'slow the reveal', split that beat into its own short scene and set its speed. Prefer hard cuts; 'dissolve' softens a scene change; 'morph' generates a ~1.3s AI bridge (~$1 each, max 2 per cut, adds to the runtime) for jumps between genuinely different subjects — mention any morph you add or remove in your summary so the owner knows the cost. Drafts preview morphs as simple dissolves."
      : "Speed is a storytelling tool: slow (0.5/0.25) a SHORT scene so a reveal lands — at most 2 ramps per cut, never the hook; slowed scenes are muted. AI morph bridges aren't available (fal.ai isn't connected) — use 'dissolve' where you'd want a morph, and say so in your summary if the owner asks for one.",
    "Remember: scenes are cut from the timestamps above; a voice-over script must read (at ~2.3 words/sec) SHORTER than the total scene time; music.query describes vibe+genre+tempo for a royalty-free search. Your `summary` is your reply to the owner — conversational, 1-2 sentences, mention anything you'd like their input on (e.g. AI b-roll would help — you may suggest it but cannot generate it).",
  ]
    .filter(Boolean)
    .join("\n");
}
