// The renderer: executes one EDL clip with ffmpeg. Cuts the chosen source
// segment(s), concatenates them, reframes 16:9 -> 9:16 with a clean centre-crop
// that fills the whole frame with real, sharp footage (no blur, no bars), burns
// animated word-synced captions (active word highlighted, "Opus" style), and
// loudness-normalises the audio. Output is a 1080x1920 H.264 MP4.
//
// The centre-crop is NOT subject/face tracking — a subject off to the side can be
// cropped out. Subject-aware cropping is a later enhancement (see plan); this is
// stated honestly in the Studio UI.

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { runFfmpeg } from "@/lib/video/ffmpeg";
import { getCaptionStyle, type CaptionStyle } from "@/lib/video/caption-styles";
import { buildCropScript, scaledWidth, type TrackPoint } from "@/lib/video/reframe";
import type { EdlClip, SegmentEffect } from "@/lib/video/edl";
import type { EmojiOverlay } from "@/lib/video/emoji";
import type { SfxEvent } from "@/lib/video/sfx";
import { buildTimeline, timelineOutDurMs, toOutMs, type TimelineEntry } from "@/lib/video/timeline";
import type { TranscriptWord } from "@/lib/video/transcribe";

const OUT_W = 1080;
const OUT_H = 1920;
const TMP_DIR = path.join(process.cwd(), "uploads", "tmp");

function fmtAssTime(ms: number): string {
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function escapeAss(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\n/g, "\\N");
}

// A single full-length pseudo entry for word sets that are ALREADY on the
// output timeline (VO alignments) — buildAss/overlays then need no remap.
export function pseudoTimeline(outDurMs: number): TimelineEntry[] {
  return [{ sourceIndex: 0, srcStartMs: 0, srcEndMs: outDurMs, speed: 1, outStartMs: 0, outDurMs }];
}

// Build an animated .ass caption track on the OUTPUT timeline. Word times are
// SOURCE times; the timeline entries carry the one true source→output mapping
// (trims, beat clamps and speed all baked in via toOutMs). Words show in a
// rolling line with the currently-spoken word highlighted in the style's
// accent colour ("Opus" look); keywords stay highlighted throughout.
function buildAss(
  entries: TimelineEntry[],
  wordsFor: (e: TimelineEntry) => TranscriptWord[],
  style: CaptionStyle,
  keywords: string[]
): string {
  const events: string[] = [];
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const kw = new Set(keywords.map(norm).filter(Boolean));

  for (const seg of entries) {
    const segWords = wordsFor(seg)
      .filter((w) => w.endMs > seg.srcStartMs && w.startMs < seg.srcEndMs)
      .map((w) => ({
        text: w.text,
        startMs: toOutMs(seg, w.startMs),
        endMs: toOutMs(seg, w.endMs),
      }));

    // Group into short lines (≤4 words / ≤2.5s) for readability.
    const lines: (typeof segWords)[] = [];
    let line: typeof segWords = [];
    for (const w of segWords) {
      if (line.length >= 4 || (line.length && w.endMs - line[0].startMs > 2500)) {
        lines.push(line);
        line = [];
      }
      line.push(w);
    }
    if (line.length) lines.push(line);

    // One event per active word: the whole line stays on screen while the active
    // word is accented; each word holds until the next begins (no flicker gaps).
    for (const ln of lines) {
      const lineEnd = ln[ln.length - 1].endMs;
      ln.forEach((w, i) => {
        const start = w.startMs;
        const end = i < ln.length - 1 ? ln[i + 1].startMs : lineEnd;
        if (end <= start) return;
        const text = ln
          .map((ww, j) => {
            const t = escapeAss(style.uppercase ? ww.text.toUpperCase() : ww.text);
            // {\r} resets to the Caption style after each run (colour, bold, scale).
            if (j === i) {
              const pop = style.pop ? "\\fscx115\\fscy115" : "";
              return `{\\1c${style.accent}&\\b1${pop}}${t}{\\r}`;
            }
            if (kw.has(norm(ww.text))) return `{\\1c${style.accent}&}${t}{\\r}`;
            return t;
          })
          .join(" ");
        events.push(`Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},Caption,,0,0,0,,${text}`);
      });
    }
  }

  // Visual identity comes from the style (font/size/outline/box/position);
  // BorderStyle 3 renders an opaque box (OutlineColour fills it) instead of an
  // outline — the IG-story look. Anchored low-centre (Alignment 2) always.
  const font = style.font ?? "Arial";
  const size = style.fontSize ?? 72;
  const borderStyle = style.backBox ? 3 : 1;
  const outlineW = style.backBox ? 12 : style.outlineWidth ?? 5;
  const shadow = style.shadow ?? 2;
  const marginV = style.marginV ?? 260;
  const backColour = style.backBox ? style.outline : "&H64000000";
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${OUT_W}`,
    `PlayResY: ${OUT_H}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
    `Style: Caption,${font},${size},${style.primary},${style.outline},${backColour},-1,${borderStyle},${outlineW},${shadow},2,60,60,${marginV}`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
  ].join("\n");
  return header;
}

// ffmpeg filter args don't allow a bare path; escape the chars that matter.
function escapeForFilter(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

// Emoji-pop overlay chain: each PNG (a looped still input starting at inputOffset)
// pops in centred above the caption block while its word is spoken. Consumes
// `fromLabel`, produces [vout]. `outH` scales the pop size/position for draft
// renders.
function emojiChain(
  parts: string[],
  overlays: EmojiOverlay[],
  fromLabel: string,
  inputOffset: number,
  outH = OUT_H
): void {
  const size = Math.round((200 / OUT_H) * outH);
  const y = Math.round((1150 / OUT_H) * outH);
  overlays.forEach((o, i) => {
    parts.push(`[${inputOffset + i}:v]scale=${size}:${size}[em${i}]`);
    const from = i === 0 ? fromLabel : `[vemoji${i - 1}]`;
    const to = i === overlays.length - 1 ? "[vout]" : `[vemoji${i}]`;
    const s = (o.startMs / 1000).toFixed(3);
    const e = (o.endMs / 1000).toFixed(3);
    // shortest=1: the looped PNG input is infinite — without it, overlay repeats
    // the last main frame forever and the render never terminates.
    parts.push(`${from}[em${i}]overlay=(main_w-overlay_w)/2:${y}:shortest=1:enable='between(t,${s},${e})'${to}`);
  });
}

// Input args for the emoji PNGs: looped stills so `enable` windows work.
function emojiInputs(overlays: EmojiOverlay[]): string[] {
  return overlays.flatMap((o) => ["-loop", "1", "-framerate", "30", "-i", o.pngPath]);
}

// Reset a segment's clock, retiming it when the timeline entry carries a
// speed. Division by speed stretches (slow-mo) or compresses (speed-up) the
// presentation timestamps; the fps filter that follows in each chain
// renormalizes to constant 30fps (duplicating/dropping frames as needed).
function setptsExpr(speed: number): string {
  return speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${speed}`;
}

// Per-segment on-screen effect → ffmpeg filter suffix. All duration-preserving.
// Zooms need a constant frame size (w,h) — callers pass the segment's frame
// dimensions, or 0x0 to disable zooms (e.g. unknown source size / track mode,
// where a competing pan is already running).
function effectFilter(effect: SegmentEffect | undefined, w: number, h: number): string {
  if (!effect || effect === "none") return "";
  if (effect === "flash_cut") return ",fade=t=in:st=0:d=0.12:color=white";
  if (!w || !h) return "";
  const zoom =
    effect === "punch_in"
      ? "min(1.08,1+0.0067*in)" // reaches 1.08x in ~0.4s at 30fps
      : "min(1.10,1+0.00035*in)"; // zoom_drift: slow creep across the segment
  return `,zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=30`;
}

// SFX events → filter parts + the labels to feed into the final amix.
function sfxFilters(parts: string[], sfx: SfxEvent[], inputOffset: number): string[] {
  return sfx.map((s, i) => {
    const at = Math.max(0, Math.round(s.atMs));
    parts.push(`[${inputOffset + i}:a]aresample=48000,adelay=${at}|${at},volume=0.4[sfx${i}]`);
    return `[sfx${i}]`;
  });
}

function sfxInputs(sfx: SfxEvent[]): string[] {
  return sfx.flatMap((s) => ["-i", s.path]);
}

export interface RenderOptions {
  burnCaptions?: boolean; // default true
  captionStyle?: string; // caption template id (see CAPTION_STYLES); default "bold"
  keywords?: string[]; // words to keep highlighted throughout the clip
  reframe?: string; // "center" (default) | "track" (follow subject)
  track?: TrackPoint[]; // subject track (source-time); required for "track"
  sourceWidth?: number; // source dimensions, needed to compute the pan range
  sourceHeight?: number;
  emojiOverlays?: EmojiOverlay[]; // emoji pops (output-timeline; see emoji.ts)
  applyEffects?: boolean; // apply planner-chosen segment effects (default true)
  sfx?: SfxEvent[]; // sound effects mixed at output-timeline positions
  musicPath?: string; // optional music bed, sidechain-ducked under the dialogue
}

/**
 * Render one clip to a temp .mp4 and return its absolute path. The caller is
 * responsible for moving it into storage and cleaning up the temp file.
 */
export async function renderClip(
  sourcePath: string,
  clip: EdlClip,
  words: TranscriptWord[],
  opts: RenderOptions = {}
): Promise<string> {
  if (!clip.segments.length) throw new Error(`Clip "${clip.title}" has no segments to render.`);
  await fs.mkdir(TMP_DIR, { recursive: true });
  const burn = opts.burnCaptions !== false && words.length > 0;

  // The one timing model: trims, output positions and (dormant in single mode)
  // speed all come from here — captions, overlays and ffmpeg must agree.
  const tl = buildTimeline(clip.segments);
  const anySpeed = tl.some((e) => e.speed !== 1);

  const assPath = path.join(TMP_DIR, `${randomUUID()}.ass`);
  if (burn) {
    const style = getCaptionStyle(opts.captionStyle);
    await fs.writeFile(assPath, buildAss(tl, () => words, style, opts.keywords ?? []), "utf8");
  }
  const outPath = path.join(TMP_DIR, `${randomUUID()}.mp4`);

  // Track mode only applies to landscape sources with a usable pan range and a
  // detected track — otherwise fall back to the static centre-crop.
  const scaledW =
    opts.sourceWidth && opts.sourceHeight
      ? scaledWidth(opts.sourceWidth, opts.sourceHeight)
      : 0;
  const trackMode =
    opts.reframe === "track" && !!opts.track?.length && scaledW > OUT_W;
  let cmdPath = "";
  const crop = trackMode ? buildCropScript(tl, opts.track!, scaledW) : null;
  if (crop) {
    cmdPath = path.join(TMP_DIR, `${randomUUID()}.cmd`);
    await fs.writeFile(cmdPath, crop.script, "utf8");
  }

  // 1) Trim each segment and reset timestamps; 2) concat; 3) reframe to 9:16
  //    (static centre-crop, or a subject-following pan); 4) burn captions;
  //    5) loudness-normalise audio.
  const parts: string[] = [];
  // Zoom effects need a constant frame size; disable them in track mode (a
  // competing pan is already running) or when the source size is unknown.
  const fxW = !trackMode && opts.applyEffects !== false ? opts.sourceWidth ?? 0 : 0;
  const fxH = !trackMode && opts.applyEffects !== false ? opts.sourceHeight ?? 0 : 0;
  tl.forEach((seg, i) => {
    const s = (seg.srcStartMs / 1000).toFixed(3);
    const e = (seg.srcEndMs / 1000).toFixed(3);
    const fx = opts.applyEffects !== false ? effectFilter(seg.effect, fxW, fxH) : "";
    // When ANY segment is retimed, every video leg gets fps=30 (concat needs
    // uniform frame timing) and every audio leg is normalized to 48k stereo so
    // sped segments' generated silence concats cleanly. At speed 1 throughout,
    // the chain is byte-identical to the pre-speed renderer.
    const vNorm = anySpeed ? ",fps=30" : "";
    parts.push(`[0:v]trim=start=${s}:end=${e},${setptsExpr(seg.speed)}${vNorm}${fx}[v${i}]`);
    if (seg.speed !== 1) {
      // Retimed segments play silent — the mix (music/VO) carries them.
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${(seg.outDurMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    } else {
      const aNorm = anySpeed ? ",aresample=48000,aformat=channel_layouts=stereo" : "";
      parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS${aNorm}[a${i}]`);
    }
  });
  const concatInputs = tl.map((_, i) => `[v${i}][a${i}]`).join("");
  parts.push(`${concatInputs}concat=n=${tl.length}:v=1:a=1[cv][ca]`);

  const overlays = opts.emojiOverlays ?? [];
  const vfinal = overlays.length ? "[vbase]" : "[vout]";
  const vtail = burn ? "[reframed]" : `,format=yuv420p${vfinal}`;
  if (crop) {
    // Scale to cover the height, then pan a named crop via sendcmd keyframes so
    // it follows the subject; the whole frame is real footage (no blur/bars).
    parts.push(`[cv]scale=-2:${OUT_H}[scaled]`);
    parts.push(
      `[scaled]sendcmd=f='${escapeForFilter(cmdPath)}',crop@cam=${OUT_W}:${OUT_H}:${crop.initialX}:0${vtail}`
    );
  } else {
    // Clean centre-crop: scale to cover 9:16, then crop to exact size.
    parts.push(
      `[cv]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H}${vtail}`
    );
  }
  if (burn) parts.push(`[reframed]ass='${escapeForFilter(assPath)}',format=yuv420p${vfinal}`);
  if (overlays.length) emojiChain(parts, overlays, "[vbase]", 1);

  // Audio: dialogue normalised; optional music bed sidechain-ducked UNDER the
  // dialogue (music swells in the gaps, dips when someone speaks); optional SFX
  // at cut points. normalize=0 keeps the dialogue at full level in the mix.
  const outDurSec = timelineOutDurMs(tl) / 1000;
  const musicIdx = 1 + overlays.length;
  const sfxIdx = musicIdx + (opts.musicPath ? 1 : 0);
  const sfx = opts.sfx ?? [];
  const mixLabels: string[] = [];
  if (opts.musicPath) {
    // A label is consumed once — split the dialogue into the mix feed and the
    // sidechain key that ducks the music.
    parts.push(`[ca]loudnorm=I=-16:TP=-1.5:LRA=11,asplit=2[dlg][dlgkey]`);
    const dur = outDurSec.toFixed(3);
    const fadeOut = Math.max(0, outDurSec - 1.5).toFixed(3);
    parts.push(
      `[${musicIdx}:a]aresample=48000,atrim=0:${dur},asetpts=PTS-STARTPTS,apad,atrim=0:${dur},asetpts=PTS-STARTPTS,` +
        `volume=0.4,afade=t=in:st=0:d=1,afade=t=out:st=${fadeOut}:d=1.5[mus]`
    );
    parts.push(`[mus][dlgkey]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[musd]`);
    mixLabels.push("[dlg]", "[musd]");
  } else {
    parts.push(`[ca]loudnorm=I=-16:TP=-1.5:LRA=11[dlg]`);
    mixLabels.push("[dlg]");
  }
  mixLabels.push(...sfxFilters(parts, sfx, sfxIdx));
  if (mixLabels.length > 1) {
    parts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[aout]`);
  } else {
    parts.push(`[dlg]anull[aout]`);
  }

  const args = [
    "-y",
    "-i",
    sourcePath,
    ...emojiInputs(overlays),
    ...(opts.musicPath ? ["-i", opts.musicPath] : []),
    ...sfxInputs(sfx),
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outPath,
  ];

  try {
    await runFfmpeg(args);
  } finally {
    if (burn) await fs.unlink(assPath).catch(() => {});
    if (cmdPath) await fs.unlink(cmdPath).catch(() => {});
  }
  return outPath;
}

// Shared H.264 output encode args (used by all renderers). Draft = the fable
// preview tier: ultrafast + high CRF, roughly 5-10x faster to encode.
function encodeArgs(outPath: string, draft = false): string[] {
  return [
    "-r", "30",
    "-c:v", "libx264", "-preset", draft ? "ultrafast" : "veryfast", "-crf", draft ? "30" : "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outPath,
  ];
}

export interface MontageRenderOptions {
  captionStyle?: string;
  keywords?: string[];
  burnCaptions?: boolean; // default true
  musicPath?: string; // if set: mute source audio, lay the reel over this music ("trailer")
  beatDurationsMs?: number[]; // beat-sync: per-segment output length (snaps cuts to the beat)
  musicStartSec?: number; // start the music at this offset (align to the first beat)
  applyEffects?: boolean; // apply planner-chosen segment effects (default true)
  sfx?: SfxEvent[]; // sound effects mixed at output-timeline positions
  sourceHasAudio?: boolean[]; // parallel to sourcePaths — silent sources (b-roll,
  //                             morph bridges) get generated silence in supercuts
}

/**
 * Render one MONTAGE clip whose segments come from several source files. Each
 * segment is trimmed from its own input and scaled+cropped to 9:16 BEFORE concat
 * (sources differ in resolution, and concat needs uniform frames), then captions
 * are optionally burned. Audio is either a supercut (each moment keeps its own
 * sound) or, when musicPath is set, the source audio is dropped and the reel plays
 * over the music track (with fades) — the "trailer" vibe. Centre-crop only (v1).
 */
export async function renderMontageClip(
  sourcePaths: string[],
  clip: EdlClip,
  wordsBySource: TranscriptWord[][],
  opts: MontageRenderOptions = {}
): Promise<string> {
  if (!clip.segments.length) throw new Error(`Clip "${clip.title}" has no segments to render.`);
  await fs.mkdir(TMP_DIR, { recursive: true });
  const music = !!opts.musicPath;
  const anyWords = wordsBySource.some((w) => w.length > 0);
  const burn = opts.burnCaptions !== false && anyWords;

  // The one timing model: beat clamps (source domain) and speed baked in.
  const tl = buildTimeline(clip.segments, opts.beatDurationsMs);

  const assPath = path.join(TMP_DIR, `${randomUUID()}.ass`);
  if (burn) {
    const style = getCaptionStyle(opts.captionStyle);
    const wordsFor = (e: TimelineEntry) => wordsBySource[e.sourceIndex] ?? [];
    await fs.writeFile(assPath, buildAss(tl, wordsFor, style, opts.keywords ?? []), "utf8");
  }
  const outPath = path.join(TMP_DIR, `${randomUUID()}.mp4`);

  // Per-segment: trim + retime + normalise fps/size/SAR so concat inputs match.
  // Segment audio is only prepared for the supercut path (music-bed drops it);
  // retimed or audio-less segments get generated silence at exact output length.
  const parts: string[] = [];
  tl.forEach((seg, i) => {
    const idx = seg.sourceIndex;
    const s = (seg.srcStartMs / 1000).toFixed(3);
    const e = (seg.srcEndMs / 1000).toFixed(3);
    // Effects run AFTER the crop so the zoompan frame size is the fixed 9:16
    // (and after fps=30, so their frame-count curves run in OUTPUT time —
    // speed-safe by construction).
    const fx = opts.applyEffects !== false ? effectFilter(seg.effect, OUT_W, OUT_H) : "";
    parts.push(
      `[${idx}:v]trim=start=${s}:end=${e},${setptsExpr(seg.speed)},fps=30,` +
        `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},setsar=1,format=yuv420p${fx}[v${i}]`
    );
    if (!music) {
      const hasAudio = opts.sourceHasAudio?.[idx] ?? true;
      if (seg.speed !== 1 || !hasAudio) {
        parts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${(seg.outDurMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        parts.push(`[${idx}:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS,aresample=48000[a${i}]`);
      }
    }
  });

  const n = tl.length;
  if (music) {
    parts.push(`${tl.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[cv]`);
  } else {
    parts.push(`${tl.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[cv][ca]`);
  }

  if (burn) parts.push(`[cv]ass='${escapeForFilter(assPath)}',format=yuv420p[vout]`);
  else parts.push(`[cv]format=yuv420p[vout]`);

  // Audio: supercut keeps each moment's sound; music mode lays the reel over
  // the track. Either way, planner-chosen SFX land on their cut points.
  const sfx = opts.sfx ?? [];
  const sfxIdx = sourcePaths.length + (music ? 1 : 0);
  const mixLabels: string[] = [];
  if (music) {
    // Trimmed/padded to the exact reel length with a gentle in/out fade.
    // Beat-sync starts the music at the first beat so the cuts stay in phase.
    const dur = timelineOutDurMs(tl) / 1000;
    const start = Math.max(0, opts.musicStartSec ?? 0);
    const musicIdx = sourcePaths.length;
    const fadeOut = Math.max(0, dur - 1.5).toFixed(3);
    parts.push(
      `[${musicIdx}:a]aresample=48000,atrim=start=${start.toFixed(3)},asetpts=PTS-STARTPTS,apad,atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=1,afade=t=out:st=${fadeOut}:d=1.5,loudnorm=I=-16:TP=-1.5:LRA=11[mbed]`
    );
    mixLabels.push("[mbed]");
  } else {
    parts.push(`[ca]loudnorm=I=-16:TP=-1.5:LRA=11[dlg]`);
    mixLabels.push("[dlg]");
  }
  mixLabels.push(...sfxFilters(parts, sfx, sfxIdx));
  if (mixLabels.length > 1) {
    parts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[aout]`);
  } else {
    parts.push(`${mixLabels[0]}anull[aout]`);
  }

  const inputPaths = music ? [...sourcePaths, opts.musicPath!] : sourcePaths;
  const inputs = [...inputPaths.flatMap((p) => ["-i", p]), ...sfxInputs(sfx)];
  const args = ["-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[vout]", "-map", "[aout]", ...encodeArgs(outPath)];

  try {
    await runFfmpeg(args);
  } finally {
    if (burn) await fs.unlink(assPath).catch(() => {});
  }
  return outPath;
}

export interface FableRenderOptions {
  captionStyle?: string;
  keywords?: string[];
  burnCaptions?: boolean; // default true
  musicPath?: string; // music bed under everything (static low level, faded)
  beatDurationsMs?: number[]; // beat-sync: per-scene output length
  musicStartSec?: number; // align music to its first beat
  applyEffects?: boolean; // default true
  sfx?: SfxEvent[];
  emojiOverlays?: EmojiOverlay[];
  vo?: { path: string; words: TranscriptWord[]; durationMs: number }; // narration on top
  sceneAudio: ("dialogue" | "mute")[]; // parallel to clip.segments
  sourceHasAudio: boolean[]; // parallel to sourcePaths — silent b-roll gets a null bed
  draft?: boolean; // 480x854 ultrafast preview
}

/**
 * Render a DIRECTOR (fable) cut: a frozen FablePlan executed as one clip.
 * Composes the proven fragments — montage multi-source video chain + effects,
 * emoji pops, voice-over on top with dialogue sidechain-ducked beneath it,
 * a low music bed, SFX at cut points. Caption rule: VO captions win (from the
 * TTS word timings, output timeline); otherwise dialogue captions per source.
 */
export async function renderFableClip(
  sourcePaths: string[],
  clip: EdlClip,
  wordsBySource: TranscriptWord[][],
  opts: FableRenderOptions
): Promise<string> {
  if (!clip.segments.length) throw new Error(`Cut "${clip.title}" has no scenes to render.`);
  await fs.mkdir(TMP_DIR, { recursive: true });

  const W = opts.draft ? 480 : OUT_W;
  const H = opts.draft ? 854 : OUT_H;
  const vo = opts.vo;
  const music = !!opts.musicPath;
  const overlays = opts.emojiOverlays ?? [];
  const sfx = opts.sfx ?? [];

  // The one timing model: beat clamps (source domain) and speed baked in.
  const tl = buildTimeline(clip.segments, opts.beatDurationsMs);
  const outDurSec = timelineOutDurMs(tl) / 1000;
  const dur = outDurSec.toFixed(3);

  // Captions: VO words (already on the output timeline) win over dialogue.
  const anyDialogueWords = wordsBySource.some((w) => w.length > 0);
  const burn = opts.burnCaptions !== false && (vo ? vo.words.length > 0 : anyDialogueWords);
  const assPath = path.join(TMP_DIR, `${randomUUID()}.ass`);
  if (burn) {
    const style = getCaptionStyle(opts.captionStyle);
    if (vo) {
      await fs.writeFile(assPath, buildAss(pseudoTimeline(Math.round(outDurSec * 1000)), () => vo.words, style, opts.keywords ?? []), "utf8");
    } else {
      const wordsFor = (e: TimelineEntry) => wordsBySource[e.sourceIndex] ?? [];
      await fs.writeFile(assPath, buildAss(tl, wordsFor, style, opts.keywords ?? []), "utf8");
    }
  }
  const outPath = path.join(TMP_DIR, `${randomUUID()}.mp4`);

  // Input order: sources…, vo?, music?, emoji…, sfx…
  const voIdx = sourcePaths.length;
  const musicIdx = voIdx + (vo ? 1 : 0);
  const emojiBase = musicIdx + (music ? 1 : 0);
  const sfxBase = emojiBase + overlays.length;

  const parts: string[] = [];

  // Per scene: video trim → uniform frames → optional effect, PLUS its audio
  // (dialogue, or equal-length silence for mute scenes / silent sources). The
  // concat MUST be interleaved (v=1:a=1): with separate video-only and
  // audio-only concats off the same inputs, loudnorm's buffering makes ffmpeg's
  // scheduler emit duplicate video frames (empirically: output doubled).
  tl.forEach((seg, i) => {
    const idx = seg.sourceIndex;
    const s = (seg.srcStartMs / 1000).toFixed(3);
    const e = (seg.srcEndMs / 1000).toFixed(3);
    const fx = opts.applyEffects !== false ? effectFilter(seg.effect, W, H) : "";
    parts.push(
      `[${idx}:v]trim=start=${s}:end=${e},${setptsExpr(seg.speed)},fps=30,` +
        `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p${fx}[v${i}]`
    );
    // Retimed scenes are always silent (the sanitizer forces audio "mute" for
    // speed ≠ 1; this guard makes the renderer safe even for hand-built plans).
    const wantsDialogue = opts.sceneAudio[i] !== "mute" && opts.sourceHasAudio[idx] && seg.speed === 1;
    if (wantsDialogue) {
      parts.push(`[${idx}:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS,aresample=48000[a${i}]`);
    } else {
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${(seg.outDurMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    }
  });
  parts.push(
    `${tl.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${tl.length}:v=1:a=1[cv][ca]`
  );
  const vfinal = overlays.length ? "[vbase]" : "[vout]";
  if (burn) parts.push(`[cv]ass='${escapeForFilter(assPath)}',format=yuv420p${vfinal}`);
  else parts.push(`[cv]format=yuv420p${vfinal}`);
  if (overlays.length) emojiChain(parts, overlays, "[vbase]", emojiBase, H);

  const mixLabels: string[] = [];
  if (vo) {
    // Narration on top; the scene audio ducks under it via sidechain.
    parts.push(`[${voIdx}:a]aresample=48000,asetpts=PTS-STARTPTS,apad,atrim=0:${dur},asetpts=PTS-STARTPTS,asplit=2[vomix][vokey]`);
    parts.push(`[ca]loudnorm=I=-16:TP=-1.5:LRA=11,volume=0.45[scn]`);
    parts.push(`[scn][vokey]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[scnd]`);
    mixLabels.push("[vomix]", "[scnd]");
  } else {
    parts.push(`[ca]loudnorm=I=-16:TP=-1.5:LRA=11[scn]`);
    mixLabels.push("[scn]");
  }
  if (music) {
    const start = Math.max(0, opts.musicStartSec ?? 0);
    const fadeOut = Math.max(0, outDurSec - 1.5).toFixed(3);
    parts.push(
      `[${musicIdx}:a]aresample=48000,atrim=start=${start.toFixed(3)},asetpts=PTS-STARTPTS,apad,atrim=0:${dur},asetpts=PTS-STARTPTS,` +
        `volume=${vo ? "0.15" : "0.3"},afade=t=in:st=0:d=1,afade=t=out:st=${fadeOut}:d=1.5[mbed]`
    );
    mixLabels.push("[mbed]");
  }
  mixLabels.push(...sfxFilters(parts, sfx, sfxBase));
  if (mixLabels.length > 1) {
    parts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
  } else {
    parts.push(`${mixLabels[0]}anull[aout]`);
  }

  const inputs = [
    ...sourcePaths.flatMap((p) => ["-i", p]),
    ...(vo ? ["-i", vo.path] : []),
    ...(music ? ["-i", opts.musicPath!] : []),
    ...emojiInputs(overlays),
    ...sfxInputs(sfx),
  ];
  const args = ["-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[vout]", "-map", "[aout]", ...encodeArgs(outPath, opts.draft)];

  try {
    await runFfmpeg(args);
  } finally {
    if (burn) await fs.unlink(assPath).catch(() => {});
  }
  return outPath;
}

export interface VoiceoverRenderOptions {
  captionStyle?: string;
  keywords?: string[];
  burnCaptions?: boolean; // default true — captions come from the VO's own word timings
  musicPath?: string; // optional quiet music bed under the narration
  sourceHasAudio?: boolean; // from the probe — skip the source bed for silent b-roll
  voDurationMs: number; // narration length (from the TTS alignment)
  sourceDurationMs: number; // footage available
  emojiOverlays?: EmojiOverlay[]; // emoji pops (output-timeline; see emoji.ts)
}

/**
 * Render a VOICE-OVER clip: the source footage plays from the top, reframed to
 * 9:16, while the ElevenLabs narration plays at full level over a quietly
 * ducked source bed (and an optional music bed). Captions are burned from the
 * narration's own word timings — no transcription pass, no drift. Output length
 * is the narration plus a short tail, never more than the footage available.
 */
export async function renderVoiceoverClip(
  sourcePath: string,
  voPath: string,
  voWords: TranscriptWord[],
  opts: VoiceoverRenderOptions
): Promise<string> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const needMs = opts.voDurationMs + 600;
  // Auto-rescue speed ramp: when the narration outruns the footage, slow the
  // whole bed (down to 0.5x) so the video covers it instead of failing. VO
  // words are output-time, so captions are untouched; the source bed is
  // dropped when meaningfully slowed (retimed audio is never shipped).
  const videoSpeed = opts.sourceDurationMs >= needMs ? 1 : Math.max(0.5, opts.sourceDurationMs / needMs);
  const outDurMs = videoSpeed === 1 ? Math.min(needMs, opts.sourceDurationMs) : Math.round(opts.sourceDurationMs / videoSpeed);
  if (outDurMs < opts.voDurationMs) {
    throw new Error(
      "The narration reads far longer than the footage (even slowed to half speed) — shorten the brief or upload a longer video."
    );
  }
  const dur = (outDurMs / 1000).toFixed(3);
  const burn = opts.burnCaptions !== false && voWords.length > 0;

  const assPath = path.join(TMP_DIR, `${randomUUID()}.ass`);
  if (burn) {
    const style = getCaptionStyle(opts.captionStyle);
    // VO words are already on the output timeline: one full-length pseudo entry.
    await fs.writeFile(assPath, buildAss(pseudoTimeline(outDurMs), () => voWords, style, opts.keywords ?? []), "utf8");
  }
  const outPath = path.join(TMP_DIR, `${randomUUID()}.mp4`);

  const music = !!opts.musicPath;
  const overlays = opts.emojiOverlays ?? [];
  const vfinal = overlays.length ? "[vbase]" : "[vout]";
  const parts: string[] = [];
  const vTrim = videoSpeed === 1 ? `trim=0:${dur},setpts=PTS-STARTPTS` : `trim=0:${(opts.sourceDurationMs / 1000).toFixed(3)},${setptsExpr(videoSpeed)}`;
  parts.push(
    `[0:v]${vTrim},fps=30,` +
      `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},setsar=1${burn ? "[reframed]" : `,format=yuv420p${vfinal}`}`
  );
  if (burn) parts.push(`[reframed]ass='${escapeForFilter(assPath)}',format=yuv420p${vfinal}`);
  if (overlays.length) emojiChain(parts, overlays, "[vbase]", 2 + (music ? 1 : 0));

  // Audio: narration at full level; source bed ducked to a constant murmur;
  // optional music bed lower still, faded in/out. normalize=0 keeps the VO hot.
  const mixIns: string[] = [];
  parts.push(`[1:a]aresample=48000,asetpts=PTS-STARTPTS,apad,atrim=0:${dur},asetpts=PTS-STARTPTS[vo]`);
  mixIns.push("[vo]");
  if (opts.sourceHasAudio && videoSpeed === 1) {
    parts.push(`[0:a]atrim=0:${dur},asetpts=PTS-STARTPTS,aresample=48000,volume=0.18[bed]`);
    mixIns.push("[bed]");
  }
  if (music) {
    const fadeOut = Math.max(0, outDurMs / 1000 - 1.5).toFixed(3);
    parts.push(
      `[2:a]aresample=48000,atrim=0:${dur},asetpts=PTS-STARTPTS,apad,atrim=0:${dur},asetpts=PTS-STARTPTS,` +
        `volume=0.12,afade=t=in:st=0:d=1,afade=t=out:st=${fadeOut}:d=1.5[mbed]`
    );
    mixIns.push("[mbed]");
  }
  if (mixIns.length > 1) {
    parts.push(`${mixIns.join("")}amix=inputs=${mixIns.length}:duration=first:normalize=0[mix]`);
    parts.push(`[mix]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
  } else {
    parts.push(`[vo]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
  }

  const inputs = [
    "-i",
    sourcePath,
    "-i",
    voPath,
    ...(music ? ["-i", opts.musicPath!] : []),
    ...emojiInputs(overlays),
  ];
  const args = ["-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[vout]", "-map", "[aout]", ...encodeArgs(outPath)];

  try {
    await runFfmpeg(args);
  } finally {
    if (burn) await fs.unlink(assPath).catch(() => {});
  }
  return outPath;
}
