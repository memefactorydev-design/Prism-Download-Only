// Studio orchestration used by the API layer: enqueue jobs and read their state.
// This module is deliberately light — it must NOT import the render/transcribe
// pipeline (ffmpeg + the ML transcription deps), which live behind the worker so
// they never enter the Next request bundle. The worker owns the heavy lifting.

import type { GeneratedClip, MediaAsset, VideoJob } from "@prisma/client";
import { db } from "@/lib/db";
import { CAPTION_STYLE_IDS, DEFAULT_CAPTION_STYLE } from "@/lib/video/caption-styles";
import { track } from "@/lib/events";

// Phase A ships reels. "ad" and "podcast" arrive in Phases B and C.
export const STUDIO_OUTPUT_KINDS = ["reel"] as const;
export type StudioOutputKind = (typeof STUDIO_OUTPUT_KINDS)[number];

// Edit options chosen on the upload panel (Opus-parity Phase D).
export interface JobOptions {
  captionStyle?: string;
  reframe?: string; // "center" | "track"
  tightEdit?: boolean;
  captions?: boolean; // burn captions (default true)
  beatSync?: boolean; // montage: snap cuts to the music beat
  beatCadence?: number; // beats per cut (1|2|4)
  blueprint?: string; // ContentTemplate blueprint to steer the edit (single mode)
  templateTitle?: string; // applied template's title (for the label/report)
  voBrief?: string; // voiceover mode: what the narration should say
  voVoiceId?: string; // voiceover mode: ElevenLabs voice id (empty = connection default)
  effects?: boolean; // apply planner-chosen on-screen effects (default true)
  sfx?: boolean; // mix cached sound effects at effect points (default true; needs ElevenLabs)
  morphs?: boolean; // montage: allow paid AI morph bridges between shots (default false)
}

function normalizeOptions(options: JobOptions) {
  return {
    captionStyle: CAPTION_STYLE_IDS.includes(options.captionStyle ?? "")
      ? options.captionStyle!
      : DEFAULT_CAPTION_STYLE,
    reframe: options.reframe === "track" ? "track" : "center",
    tightEdit: Boolean(options.tightEdit),
    captions: options.captions !== false, // default on
    beatSync: Boolean(options.beatSync),
    beatCadence: [1, 2, 4].includes(options.beatCadence ?? 2) ? options.beatCadence! : 2,
    blueprint: options.blueprint?.trim() ? options.blueprint.trim().slice(0, 4000) : null,
    templateTitle: options.templateTitle?.trim() ? options.templateTitle.trim().slice(0, 200) : null,
    voBrief: options.voBrief?.trim() ? options.voBrief.trim().slice(0, 1500) : null,
    voVoiceId: options.voVoiceId?.trim() ? options.voVoiceId.trim().slice(0, 64) : null,
    effects: options.effects !== false,
    sfx: options.sfx !== false,
    morphs: Boolean(options.morphs),
  };
}

// Jobs are per-user like everything else: scopeUserId "" is the workspace,
// anything else is that member's sandbox (their sources, their rendered clips).
export async function enqueueJob(
  sourceAssetId: string,
  outputKinds: string[],
  options: JobOptions = {},
  musicAssetId?: string | null,
  scopeUserId = ""
): Promise<VideoJob> {
  track("job_started", scopeUserId, { mode: "single" });
  const kinds = outputKinds.filter((k): k is StudioOutputKind =>
    (STUDIO_OUTPUT_KINDS as readonly string[]).includes(k)
  );
  return db.videoJob.create({
    data: {
      userId: scopeUserId,
      sourceAssetId,
      outputKinds: (kinds.length ? kinds : ["reel"]).join(","),
      // Single mode: an optional music bed, sidechain-ducked under the dialogue.
      musicAssetId: musicAssetId || null,
      ...normalizeOptions(options),
    },
  });
}

// Voice-over: one source video; an agent writes the narration and ElevenLabs
// reads it. Renders exactly one clip, so it needs no output-kind selection.
export async function enqueueVoiceover(
  sourceAssetId: string,
  options: JobOptions = {},
  musicAssetId?: string | null,
  scopeUserId = ""
): Promise<VideoJob> {
  track("job_started", scopeUserId, { mode: "voiceover" });
  return db.videoJob.create({
    data: {
      userId: scopeUserId,
      mode: "voiceover",
      sourceAssetId,
      outputKinds: "reel",
      musicAssetId: musicAssetId || null,
      ...normalizeOptions(options),
    },
  });
}

// Max input videos per montage job — bounds render inputs and detection/transcribe cost.
export const MAX_MONTAGE_SOURCES = 8;

// Create one montage job that mixes moments across several uploaded sources.
// An optional music track turns it into a music-bed "trailer" montage (dialogue
// muted, cuts over the music).
export async function enqueueMontage(
  assetIds: string[],
  options: JobOptions = {},
  musicAssetId?: string | null,
  scopeUserId = ""
): Promise<VideoJob> {
  track("job_started", scopeUserId, { mode: "montage" });
  const ids = [...new Set(assetIds)].slice(0, MAX_MONTAGE_SOURCES);
  if (ids.length < 2) throw new Error("A montage needs at least 2 videos.");
  const assets = await db.mediaAsset.findMany({ where: { id: { in: ids } } });
  const found = new Set(assets.map((a) => a.id));
  const ordered = ids.filter((id) => found.has(id));
  if (ordered.length < 2) throw new Error("Some uploaded videos could not be found — re-upload and retry.");

  let music: string | null = null;
  if (musicAssetId) {
    const m = await db.mediaAsset.findUnique({ where: { id: musicAssetId } });
    if (!m) throw new Error("The music track could not be found — re-upload it.");
    music = m.id;
  }

  // reframe/tightEdit are single-source only in v1; force montage to centre-crop.
  const opts = normalizeOptions({ ...options, reframe: "center", tightEdit: false });
  return db.videoJob.create({
    data: {
      userId: scopeUserId,
      mode: "montage",
      sourceAssetId: ordered[0], // satisfies the non-null column; unused by montage logic
      outputKinds: "reel",
      musicAssetId: music,
      ...opts,
      sources: { create: ordered.map((assetId, index) => ({ index, assetId })) },
    },
  });
}

export interface JobView {
  job: VideoJob;
  source: MediaAsset | null;
  clips: GeneratedClip[];
}

export async function getJobView(id: string, actor?: { id: string; role: string }): Promise<JobView | null> {
  const job = await db.videoJob.findUnique({
    where: { id },
    include: { clips: { orderBy: [{ kind: "asc" }, { rank: "asc" }] } },
  });
  if (!job) return null;
  if (actor && actor.role !== "admin" && job.userId !== actor.id) return null;
  const source = await db.mediaAsset.findUnique({ where: { id: job.sourceAssetId } });
  return { job, source, clips: job.clips };
}

export async function listJobs(actor?: { id: string; role: string }): Promise<JobView[]> {
  const jobs = await db.videoJob.findMany({
    where: actor && actor.role !== "admin" ? { userId: actor.id } : undefined,
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { clips: { orderBy: [{ kind: "asc" }, { rank: "asc" }] } },
  });
  const assetIds = jobs.map((j) => j.sourceAssetId);
  const assets = await db.mediaAsset.findMany({ where: { id: { in: assetIds } } });
  const byId = new Map(assets.map((a) => [a.id, a]));
  return jobs.map((job) => ({ job, source: byId.get(job.sourceAssetId) ?? null, clips: job.clips }));
}
