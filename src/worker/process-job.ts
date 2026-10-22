// Runs one VideoJob end to end: probe -> transcribe -> plan (Claude or fallback)
// -> render each clip with ffmpeg -> store outputs. Progress and stage are written
// to the DB throughout so the Studio UI can poll them. Every failure path records
// a readable errorMessage and marks the job/clip failed — never a silent stall.

import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { Prisma, VideoJob } from "@prisma/client";
import { db } from "@/lib/db";
import { engineReady } from "@/lib/llm";
import { getStorage, localFilePath } from "@/lib/storage";
import { probeVideo } from "@/lib/video/probe";
import { transcribe, type Transcript, type TranscriptWord } from "@/lib/video/transcribe";
import {
  planReels,
  fallbackReels,
  planMontage,
  fallbackMontage,
  type EdlClip,
  type PlanResult,
  type MontageSource,
} from "@/lib/video/edl";
import { tightenClip } from "@/lib/video/tighten";
import { relevantTrendInsights } from "@/lib/trends";
import { detectSubjectTrack, type TrackPoint } from "@/lib/video/reframe";
import { detectBeats, buildBeatDurations, type BeatInfo } from "@/lib/video/beat";
import { renderClip, renderMontageClip, renderVoiceoverClip } from "@/lib/video/render";
import { buildEmojiOverlays } from "@/lib/video/emoji";
import { buildSfxEvents } from "@/lib/video/sfx";
import { buildTimeline } from "@/lib/video/timeline";
import { pseudoTimeline } from "@/lib/video/render";
import { extractStyledFrame, resolveBridge } from "@/lib/video/morph";
import { MORPH_BRIDGE_OUT_MS, MORPH_MAX_PER_JOB } from "@/lib/video/transitions";
import { falConnected } from "@/lib/fal";
import { processFablePrep, processFableRender } from "@/worker/process-fable";
import { ttsWithTimestamps } from "@/lib/elevenlabs";
import { runAgent } from "@/lib/agents/run-agent";

const RENDER_CONCURRENCY = Math.max(
  1,
  Number(process.env.RENDER_CONCURRENCY) || os.cpus().length - 1 || 1
);

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const update = (id: string, data: Prisma.VideoJobUpdateInput) =>
  db.videoJob.update({ where: { id }, data });

// Bounded-concurrency map — render several clips at once without spawning N ffmpegs.
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

export async function processJob(job: VideoJob): Promise<void> {
  // Montage and voice-over jobs take separate paths; the single-source flow
  // below is unchanged.
  if (job.mode === "montage") {
    await processMontage(job);
    return;
  }
  if (job.mode === "voiceover") {
    await processVoiceover(job);
    return;
  }
  if (job.mode === "fable_prep") {
    await processFablePrep(job);
    return;
  }
  if (job.mode === "adfilm") {
    const { processAdFilm } = await import("@/worker/process-adfilm");
    await processAdFilm(job);
    return;
  }
  if (job.mode === "fable") {
    await processFableRender(job);
    return;
  }
  try {
    const source = await db.mediaAsset.findUnique({ where: { id: job.sourceAssetId } });
    if (!source) throw new Error("Source media for this job is missing from storage.");
    const sourcePath = localFilePath({
      storageDriver: source.storageDriver as "local" | "s3",
      storagePath: source.storagePath,
    });

    // 1. Probe — and backfill the source asset's dimensions/duration.
    await update(job.id, { status: "probing", stage: "Watching your footage", progress: 5 });
    const probe = await probeVideo(sourcePath);
    await db.mediaAsset.update({
      where: { id: source.id },
      data: { width: probe.width, height: probe.height, durationSecs: probe.durationSecs },
    });

    // 2. Transcribe (cached on the job so re-runs never re-transcribe).
    let transcript: Transcript;
    if (job.transcript) {
      transcript = JSON.parse(job.transcript) as Transcript;
    } else {
      await update(job.id, {
        status: "transcribing",
        stage: "Listening for every word",
        progress: 15,
      });
      transcript = await transcribe(sourcePath);
      await update(job.id, { transcript: JSON.stringify(transcript) });
    }

    // 3. Plan the edit — Claude when connected, labelled fallback otherwise.
    await update(job.id, { status: "planning", stage: "Finding the moments worth keeping", progress: 40 });
    const ideas = await db.adIdea.findMany({
      where: { status: { not: "archived" }, userId: job.userId },
      orderBy: { rank: "asc" },
      take: 15,
    });
    const trends = await relevantTrendInsights(transcript.text, 6, job.userId);
    const plan: PlanResult = (await engineReady())
      ? await planReels(transcript, ideas, probe.durationSecs, trends, job.blueprint, job.templateTitle, job.userId)
      : fallbackReels(transcript);

    if (!plan.clips.length) {
      // A "nothing found" result is a FAILURE to the user, not a green tick —
      // and it comes with a fork (retry / voice-over re-cut) in the Studio UI.
      await update(job.id, {
        status: "failed",
        progress: 100,
        stage: "No strong standalone moments found.",
        errorMessage:
          "This footage doesn't have a strong standalone moment for a reel on its own. Try a voice-over cut instead — narration carries footage like this — or try again after trimming the upload to the best part.",
      });
      return;
    }

    // Opt-in: remove filler words + dead air, tightening each clip's segments.
    if (job.tightEdit) {
      plan.clips = plan.clips.map((c) => tightenClip(c, transcript.words));
    }

    // Opt-in: detect the subject once per source (cached) so the crop can follow
    // them. Falls back to centre-crop inside renderClip if the track is unusable.
    let subjectTrack: TrackPoint[] = [];
    if (job.reframe === "track") {
      if (job.subjectTrack) {
        subjectTrack = JSON.parse(job.subjectTrack) as TrackPoint[];
      } else {
        await update(job.id, { stage: "Following your speaker across the frame", progress: 50 });
        // Only detect within the selected clip ranges — far fewer frames than the
        // whole source, and report progress so the UI isn't frozen.
        const ranges = plan.clips.flatMap((c) => c.segments);
        subjectTrack = await detectSubjectTrack(sourcePath, probe.durationSecs, {
          ranges,
          onProgress: async (done, total) => {
            await update(job.id, {
              stage: `Tracking the speaker (${done}/${total} frames)`,
              progress: 50 + Math.round((done / total) * 8),
            });
          },
        });
        await update(job.id, { subjectTrack: JSON.stringify(subjectTrack) });
      }
    }

    // Persist the plan as clip rows before rendering, so the UI shows the lineup.
    const rows = await Promise.all(
      plan.clips.map((c) =>
        db.generatedClip.create({
          data: {
            jobId: job.id,
            kind: "reel",
            rank: c.rank,
            title: c.title,
            hook: c.hook,
            caption: c.caption || null,
            sourceInMs: c.segments[0]?.startMs ?? null,
            sourceOutMs: c.segments[c.segments.length - 1]?.endMs ?? null,
            edl: JSON.stringify(c),
            status: "planned",
            viralityScore: c.viralityScore ?? null,
            viralityRationale: c.viralityRationale ?? null,
            keywords: c.keywords ? JSON.stringify(c.keywords) : null,
          },
        })
      )
    );

    // Optional single-mode music bed (sidechain-ducked under the dialogue).
    let musicPath: string | undefined;
    if (job.musicAssetId) {
      const musicAsset = await db.mediaAsset.findUnique({ where: { id: job.musicAssetId } });
      if (musicAsset) {
        musicPath = localFilePath({
          storageDriver: musicAsset.storageDriver as "local" | "s3",
          storagePath: musicAsset.storagePath,
        });
      }
    }

    // 4. Render each clip (parallel, capped). Failures are per-clip, not fatal.
    await update(job.id, {
      status: "rendering",
      stage: `Cutting ${rows.length} reels — each appears below the moment it finishes`,
      progress: 60,
    });
    let done = 0;
    let failed = 0;
    const tasks = plan.clips.map((clip, idx) => ({ clip, row: rows[idx] }));
    await pool(tasks, RENDER_CONCURRENCY, async ({ clip, row }) => {
      await db.generatedClip.update({ where: { id: row.id }, data: { status: "rendering" } });
      try {
        await renderOne(sourcePath, clip, transcript, row.id, job.captionStyle, job.captions, {
          reframe: job.reframe,
          track: subjectTrack,
          width: probe.width,
          height: probe.height,
        }, {
          applyEffects: job.effects,
          sfxOn: job.sfx,
          musicPath,
        });
      } catch (err) {
        failed++;
        await db.generatedClip.update({
          where: { id: row.id },
          data: { status: "failed", errorMessage: msg(err) },
        });
      } finally {
        done++;
        await update(job.id, { progress: 60 + Math.round((done / rows.length) * 38) });
      }
    });

    const rendered = rows.length - failed;
    await update(job.id, {
      status: failed === 0 ? "complete" : rendered > 0 ? "partial" : "failed",
      progress: 100,
      stage: `${rendered}/${rows.length} reels rendered.`,
      errorMessage: failed ? `${failed} clip(s) failed to render — open them for the reason.` : null,
    });
  } catch (err) {
    await update(job.id, { status: "failed", errorMessage: msg(err) });
  }
}

async function renderOne(
  sourcePath: string,
  clip: EdlClip,
  transcript: Transcript,
  rowId: string,
  captionStyle: string,
  captions: boolean,
  reframe: { reframe: string; track: TrackPoint[]; width: number | null; height: number | null },
  extras: { applyEffects: boolean; sfxOn: boolean; musicPath?: string }
): Promise<void> {
  // Emoji pops only make sense alongside burned captions. The timeline here
  // matches the renderer's own (same segments, no beat) by construction.
  const tl = buildTimeline(clip.segments);
  const emojiOverlays = captions
    ? await buildEmojiOverlays(tl, () => transcript.words, clip.emojiHints)
    : [];
  const sfx = extras.sfxOn ? await buildSfxEvents(tl) : [];
  const tmp = await renderClip(sourcePath, clip, transcript.words, {
    burnCaptions: captions,
    captionStyle,
    keywords: clip.keywords,
    reframe: reframe.reframe,
    track: reframe.track,
    sourceWidth: reframe.width ?? undefined,
    sourceHeight: reframe.height ?? undefined,
    emojiOverlays,
    applyEffects: extras.applyEffects,
    sfx,
    musicPath: extras.musicPath,
  });
  await storeRendered(tmp, clip.title, rowId);
}

// Store a rendered temp file as a MediaAsset and link it to the clip row.
// The asset lands in the owning JOB's scope, so a member's rendered clips
// appear in their library, not the workspace's.
async function storeRendered(tmpPath: string, title: string, rowId: string): Promise<void> {
  try {
    const buffer = await fs.readFile(tmpPath);
    const stored = await getStorage().save(buffer, ".mp4");
    const row = await db.generatedClip.findUnique({ where: { id: rowId }, include: { job: true } });
    const asset = await db.mediaAsset.create({
      data: {
        userId: row?.job.userId ?? "",
        originalName: `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "reel"}.mp4`,
        mimeType: "video/mp4",
        sizeBytes: buffer.length,
        storageDriver: stored.storageDriver,
        storagePath: stored.storagePath,
      },
    });
    await db.generatedClip.update({
      where: { id: rowId },
      data: { status: "rendered", assetId: asset.id, errorMessage: null },
    });
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

// ─── Voice-over path ─────────────────────────────────────────────────────────
// Upload → context transcript → script agent → ElevenLabs narration (with word
// timings) → one rendered clip: footage + VO + captions from the TTS alignment.
// Kept entirely separate from the single-source flow above.

const VO_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short clip title for the Studio list." },
    hook: { type: "string", description: "The opening line, verbatim from the script." },
    script: { type: "string", description: "The full narration, plain prose — read aloud verbatim." },
    caption: { type: "string", description: "Ready-to-post social caption for the finished video (hashtags inline)." },
    keywords: { type: "array", items: { type: "string" }, description: "2-5 single words from the script to emphasise in captions." },
    emojiHints: {
      type: "array",
      description:
        "0-4 emoji pops: each pairs ONE exact word from the script with ONE fitting emoji, shown over the captions as the word is narrated. Empty array if none fit.",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          emoji: { type: "string" },
        },
        required: ["word", "emoji"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "hook", "script", "caption", "keywords", "emojiHints"],
  additionalProperties: false,
};

interface VoPayload {
  title: string;
  hook: string;
  script: string;
  caption: string;
  keywords: string[];
  emojiHints: { word: string; emoji: string }[];
}

async function processVoiceover(job: VideoJob): Promise<void> {
  const tmpDir = path.join(process.cwd(), "uploads", "tmp");
  let voPath = "";
  try {
    const source = await db.mediaAsset.findUnique({ where: { id: job.sourceAssetId } });
    if (!source) throw new Error("Source media for this job is missing from storage.");
    const sourcePath = localFilePath({
      storageDriver: source.storageDriver as "local" | "s3",
      storagePath: source.storagePath,
    });

    // 1. Probe — and backfill the source asset's dimensions/duration.
    await update(job.id, { status: "probing", stage: "Watching your footage", progress: 5 });
    const probe = await probeVideo(sourcePath);
    await db.mediaAsset.update({
      where: { id: source.id },
      data: { width: probe.width, height: probe.height, durationSecs: probe.durationSecs },
    });

    // 2. Context transcript (what can be heard) — skipped for silent b-roll.
    let transcript: Transcript = { text: "", words: [] };
    if (job.transcript) {
      transcript = JSON.parse(job.transcript) as Transcript;
    } else if (probe.hasAudio) {
      await update(job.id, {
        status: "transcribing",
        stage: "Listening to the footage",
        progress: 15,
      });
      // Tolerant: music-only/ambient audio just means no context transcript —
      // the narration script is written from the brief either way.
      try {
        transcript = await transcribe(sourcePath);
      } catch {
        transcript = { text: "", words: [] };
      }
      await update(job.id, { transcript: JSON.stringify(transcript) });
    }

    // 3. Script — the agent writes narration sized to the footage.
    if (!(await engineReady())) {
      throw new Error("Voice-over needs an AI engine (sign in to Claude Code or Codex, or add an API key on Connections) — the script agent writes the narration.");
    }
    await update(job.id, { status: "planning", stage: "Writing your narration", progress: 35 });
    const targetWords = Math.max(20, Math.round(probe.durationSecs * 0.85 * 2.3));
    const trends = await relevantTrendInsights(`${job.voBrief ?? ""} ${transcript.text}`.trim(), 6, job.userId);
    const task = [
      `Write a voice-over script for a ${Math.round(probe.durationSecs)}-second video. Target about ${targetWords} words — the read must never outrun the footage.`,
      "",
      "## Owner's brief",
      job.voBrief?.trim() || "(none given — infer the subject from the footage audio below and keep it brand-general)",
      "",
      "## What can be heard in the footage",
      transcript.text.trim() ? transcript.text.slice(0, 4000) : "(silent footage / b-roll)",
      trends.length
        ? `\n## Current trend signals (use where relevant)\n${trends.map((t) => `- [${t.platform}] ${t.title}: hook "${t.hook}"`).join("\n")}`
        : "",
    ].join("\n");
    const { data } = await runAgent<VoPayload>("voiceover-script-agent", task, {
      schema: VO_SCHEMA,
      maxTokens: 4000,
      reportKind: "voiceover_script",
      reportTitle: `Voice-over: ${source.originalName}`,
      scopeUserId: job.userId,
    });
    if (!data?.script?.trim()) throw new Error("voiceover-script-agent returned no script.");

    // 4. Narrate — ElevenLabs TTS with word-level timings for the captions.
    await update(job.id, { status: "planning", stage: "Recording the voice-over", progress: 55 });
    const vo = await ttsWithTimestamps(data.script.trim(), job.voVoiceId ?? undefined);
    await fs.mkdir(tmpDir, { recursive: true });
    voPath = path.join(tmpDir, `${randomUUID()}.mp3`);
    await fs.writeFile(voPath, vo.buffer);

    // 5. Optional music bed under the narration.
    let musicPath: string | undefined;
    if (job.musicAssetId) {
      const music = await db.mediaAsset.findUnique({ where: { id: job.musicAssetId } });
      if (music) {
        musicPath = localFilePath({
          storageDriver: music.storageDriver as "local" | "s3",
          storagePath: music.storagePath,
        });
      }
    }

    // 6. Render the one clip and store it.
    // Mirror the renderer's auto-rescue: short footage is slowed (down to
    // 0.5x) to cover the narration, so the output can now run LONGER than the
    // source. Keep this math in lockstep with renderVoiceoverClip.
    const sourceMs = Math.round(probe.durationSecs * 1000);
    const needMs = vo.durationMs + 600;
    const rescueSpeed = sourceMs >= needMs ? 1 : Math.max(0.5, sourceMs / needMs);
    const outDurMs = rescueSpeed === 1 ? Math.min(needMs, sourceMs) : Math.round(sourceMs / rescueSpeed);
    if (rescueSpeed !== 1) {
      await update(job.id, {
        stage: `Slowing the footage to ${rescueSpeed.toFixed(2)}x so the narration fits`,
      });
    }
    const row = await db.generatedClip.create({
      data: {
        jobId: job.id,
        kind: "reel",
        rank: 1,
        title: data.title || "Voice-over reel",
        hook: data.hook || "",
        caption: data.caption || null,
        voScript: data.script.trim(),
        edl: JSON.stringify([{ startMs: 0, endMs: outDurMs }]),
        status: "rendering",
        keywords: JSON.stringify(data.keywords ?? []),
      },
    });
    await update(job.id, { status: "rendering", stage: "Cutting the narrated reel", progress: 70 });
    try {
      const emojiOverlays = job.captions
        ? await buildEmojiOverlays(pseudoTimeline(outDurMs), () => vo.words, data.emojiHints)
        : [];
      const tmp = await renderVoiceoverClip(sourcePath, voPath, vo.words, {
        captionStyle: job.captionStyle,
        keywords: data.keywords ?? [],
        burnCaptions: job.captions,
        musicPath,
        sourceHasAudio: probe.hasAudio,
        voDurationMs: vo.durationMs,
        sourceDurationMs: sourceMs,
        emojiOverlays,
      });
      await storeRendered(tmp, data.title || "voiceover-reel", row.id);
    } catch (err) {
      await db.generatedClip.update({
        where: { id: row.id },
        data: { status: "failed", errorMessage: msg(err) },
      });
      throw err;
    }

    await update(job.id, { status: "complete", progress: 100, stage: "Narrated reel rendered." });
  } catch (err) {
    await update(job.id, { status: "failed", errorMessage: msg(err), stage: "Failed" });
  } finally {
    if (voPath) await fs.unlink(voPath).catch(() => {});
  }
}

// Montage path: mix the best moments across several source videos into supercut
// reels. Kept entirely separate from the single-source flow above.
async function processMontage(job: VideoJob): Promise<void> {
  try {
    const rows0 = await db.videoSource.findMany({ where: { jobId: job.id }, orderBy: { index: "asc" } });
    if (rows0.length < 2) throw new Error("A montage needs at least 2 source videos.");
    await update(job.id, { status: "probing", stage: `Reading ${rows0.length} videos`, progress: 5 });

    const sourcePaths: string[] = [];
    const wordsBySource: TranscriptWord[][] = [];
    const sourceHasAudio: boolean[] = [];
    const built: MontageSource[] = [];

    for (let i = 0; i < rows0.length; i++) {
      const src = rows0[i];
      const asset = await db.mediaAsset.findUnique({ where: { id: src.assetId } });
      if (!asset) throw new Error(`Source video ${i + 1} is missing from storage.`);
      const p = localFilePath({
        storageDriver: asset.storageDriver as "local" | "s3",
        storagePath: asset.storagePath,
      });
      sourcePaths.push(p);
      const probe = await probeVideo(p);
      sourceHasAudio.push(probe.hasAudio);
      await db.mediaAsset.update({
        where: { id: asset.id },
        data: { width: probe.width, height: probe.height, durationSecs: probe.durationSecs },
      });

      let transcript: Transcript;
      if (src.transcript) {
        transcript = JSON.parse(src.transcript) as Transcript;
      } else {
        await update(job.id, {
          status: "transcribing",
          stage: `Transcribing video ${i + 1}/${rows0.length}`,
          progress: 10 + Math.round((i / rows0.length) * 25),
        });
        // Tolerant: a silent / music-only clip just gets no captions — it must not
        // fail the whole montage (these are often pre-cut b-roll clips).
        try {
          transcript = await transcribe(p);
        } catch {
          transcript = { text: "", words: [] };
        }
        await db.videoSource.update({
          where: { id: src.id },
          data: {
            transcript: JSON.stringify(transcript),
            width: probe.width,
            height: probe.height,
            durationSecs: probe.durationSecs,
          },
        });
      }
      wordsBySource.push(transcript.words);
      built.push({ index: i, filename: asset.originalName, transcript, durationSecs: probe.durationSecs });
    }

    // Optional music track → music-bed "trailer" montage (dialogue muted).
    let musicPath: string | undefined;
    if (job.musicAssetId) {
      const m = await db.mediaAsset.findUnique({ where: { id: job.musicAssetId } });
      if (m) {
        musicPath = localFilePath({
          storageDriver: m.storageDriver as "local" | "s3",
          storagePath: m.storagePath,
        });
      }
    }

    // Beat-sync: detect the music's beat once (falls back to un-synced on failure).
    let beat: BeatInfo | null = null;
    if (job.beatSync && musicPath) {
      await update(job.id, { stage: "Feeling out the music's beat", progress: 38 });
      beat = await detectBeats(musicPath);
    }

    // Plan the montage (Claude when connected; labelled fallback otherwise).
    await update(job.id, {
      status: "planning",
      stage: musicPath ? "Cutting the trailer" : "Mixing the best moments",
      progress: 40,
    });
    const ideas = await db.adIdea.findMany({
      where: { status: { not: "archived" }, userId: job.userId },
      orderBy: { rank: "asc" },
      take: 15,
    });
    const trends = await relevantTrendInsights(built.map((s) => s.transcript.text).join(" "), 6, job.userId);
    const morphsAvailable = job.morphs && (await falConnected());
    const plan: PlanResult = (await engineReady())
      ? await planMontage(built, ideas, trends, { trailer: !!musicPath, morphs: morphsAvailable }, job.userId)
      : fallbackMontage(built);

    // A montage must always produce something: if the planner selected nothing
    // (e.g. pre-cropped clips with little speech), stitch the uploaded videos in
    // order as one reel. This is the "just stitch my clips" path.
    if (!plan.clips.length) {
      await update(job.id, { stage: "Stitching your clips in order", progress: 55 });
      plan.clips = [
        {
          rank: 1,
          title: "Stitched montage",
          hook: "",
          caption: "",
          segments: built.map((s) => ({
            sourceIndex: s.index,
            startMs: 0,
            endMs: Math.round(s.durationSecs * 1000),
          })),
        },
      ];
    }

    const rows = await Promise.all(
      plan.clips.map((c) =>
        db.generatedClip.create({
          data: {
            jobId: job.id,
            kind: "reel",
            rank: c.rank,
            title: c.title,
            hook: c.hook,
            caption: c.caption || null,
            sourceInMs: c.segments[0]?.startMs ?? null,
            sourceOutMs: c.segments[c.segments.length - 1]?.endMs ?? null,
            edl: JSON.stringify(c),
            status: "planned",
            viralityScore: c.viralityScore ?? null,
            viralityRationale: c.viralityRationale ?? null,
            keywords: c.keywords ? JSON.stringify(c.keywords) : null,
          },
        })
      )
    );

    await update(job.id, {
      status: "rendering",
      stage: `Cutting ${rows.length} montage reels — each appears below the moment it finishes`,
      progress: 60,
    });
    let done = 0;
    let failed = 0;
    // AI morph budget is job-wide (rank-first — tasks start in rank order);
    // dissolves are free and uncapped. effects:false plays everything plain.
    let morphBudget = morphsAvailable && job.effects ? MORPH_MAX_PER_JOB : 0;
    const tasks = plan.clips.map((clip, idx) => ({ clip, row: rows[idx] }));
    await pool(tasks, RENDER_CONCURRENCY, async ({ clip, row }) => {
      await db.generatedClip.update({ where: { id: row.id }, data: { status: "rendering" } });
      try {
        const beatDurationsMs = beat
          ? buildBeatDurations(beat, job.beatCadence, clip.segments.length)
          : undefined;

        // Materialize dissolve/morph bridges as first-class silent segments
        // (per-clip COPIES of the source lists — clips render concurrently).
        const clipPaths = [...sourcePaths];
        const clipWords = [...wordsBySource];
        const clipHasAudio = [...sourceHasAudio];
        let execSegments = clip.segments;
        let execBeats = beatDurationsMs;
        if (job.effects && clip.segments.some((s, i) => i > 0 && (s.transition === "morph" || s.transition === "dissolve"))) {
          const provisional = buildTimeline(clip.segments, beatDurationsMs);
          const outSegs: typeof clip.segments = [];
          const outBeats: number[] = [];
          const bridgeLog: Record<string, unknown>[] = [];
          for (let i = 0; i < clip.segments.length; i++) {
            const seg = clip.segments[i];
            if (i > 0 && (seg.transition === "morph" || seg.transition === "dissolve")) {
              const prev = provisional[i - 1];
              const next = provisional[i];
              const wantAi = seg.transition === "morph" && morphBudget > 0;
              if (wantAi) morphBudget--; // reserve before the slow render
              // A transition is decoration: ANY failure (frame extraction
              // included) degrades to a hard cut — never the clip.
              let frameA = "";
              let frameB = "";
              try {
                frameA = await extractStyledFrame(clipPaths[prev.sourceIndex], prev.srcEndMs - 33);
                frameB = await extractStyledFrame(clipPaths[next.sourceIndex], next.srcStartMs);
                const bridge = await resolveBridge({
                  framePathA: frameA,
                  framePathB: frameB,
                  useAi: wantAi,
                  userId: job.userId,
                  jobId: job.id,
                });
                if (wantAi && (bridge.kind !== "morph" || bridge.cached)) morphBudget++; // refund unspent
                const bIdx = clipPaths.length;
                clipPaths.push(bridge.path);
                clipWords.push([]);
                clipHasAudio.push(false);
                const durMs = Math.round(bridge.durationSecs * 1000);
                const speed = bridge.kind === "morph" ? Math.min(4, durMs / MORPH_BRIDGE_OUT_MS) : 1;
                outSegs.push({ sourceIndex: bIdx, startMs: 0, endMs: durMs, effect: "none", speed });
                outBeats.push(0);
                bridgeLog.push({ kind: bridge.kind, cached: bridge.cached, clip: row.id, intoSegment: i });
              } catch (err) {
                if (wantAi) morphBudget++; // refund — nothing was rendered
                console.error("[montage] bridge failed, using a hard cut:", msg(err));
                bridgeLog.push({ kind: "skipped", clip: row.id, intoSegment: i, reason: msg(err).slice(0, 160) });
              } finally {
                if (frameA) await fs.unlink(frameA).catch(() => {});
                if (frameB) await fs.unlink(frameB).catch(() => {});
              }
            }
            outSegs.push(seg);
            outBeats.push(beatDurationsMs?.[i] ?? 0);
          }
          execSegments = outSegs;
          execBeats = beatDurationsMs ? outBeats : undefined;
          if (bridgeLog.length) {
            const fresh = await db.videoJob.findUnique({ where: { id: job.id }, select: { renderLog: true } });
            const prior = fresh?.renderLog ? (JSON.parse(fresh.renderLog) as unknown[]) : [];
            await update(job.id, { renderLog: JSON.stringify([...prior, ...bridgeLog]) });
          }
        }
        const execClip = { ...clip, segments: execSegments };

        const tmp = await renderMontageClip(clipPaths, execClip, clipWords, {
          captionStyle: job.captionStyle,
          keywords: clip.keywords,
          burnCaptions: job.captions,
          musicPath,
          beatDurationsMs: execBeats,
          musicStartSec: beat?.firstBeatSec,
          applyEffects: job.effects,
          sfx: job.sfx ? await buildSfxEvents(buildTimeline(execClip.segments, execBeats)) : [],
          sourceHasAudio: clipHasAudio,
        });
        await storeRendered(tmp, clip.title, row.id);
      } catch (err) {
        failed++;
        await db.generatedClip.update({
          where: { id: row.id },
          data: { status: "failed", errorMessage: msg(err) },
        });
      } finally {
        done++;
        await update(job.id, { progress: 60 + Math.round((done / rows.length) * 38) });
      }
    });

    const rendered = rows.length - failed;
    await update(job.id, {
      status: failed === 0 ? "complete" : rendered > 0 ? "partial" : "failed",
      progress: 100,
      stage: `${rendered}/${rows.length} montage reels rendered.`,
      errorMessage: failed ? `${failed} clip(s) failed to render — open them for the reason.` : null,
    });
  } catch (err) {
    await update(job.id, { status: "failed", errorMessage: msg(err) });
  }
}
