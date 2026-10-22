// Director (fable) worker stages. Prep: probe + transcribe every project
// source ONCE (cached on FableSource; render jobs copy, never re-transcribe).
// Render (processFableRender) executes a FROZEN FablePlan — pure execution,
// zero LLM calls: planning already happened in the chat.

import type { Prisma, VideoJob } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorage, localFilePath } from "@/lib/storage";
import { planTimelineMs, planToEdlClip, type FablePlan } from "@/lib/fable";
import { composeMusicAsset, musicEngine } from "@/lib/music";
import { detectBeats, buildBeatDurations, type BeatInfo } from "@/lib/video/beat";
import { buildEmojiOverlays } from "@/lib/video/emoji";
import { buildTimeline, timelineOutDurMs } from "@/lib/video/timeline";
import { pseudoTimeline } from "@/lib/video/render";
import { extractStyledFrame, resolveBridge } from "@/lib/video/morph";
import { MORPH_BRIDGE_OUT_MS, MORPH_MAX_PER_RENDER, PHOTO_ANIMATE_MS } from "@/lib/video/transitions";
import { resolveAnimation } from "@/lib/video/animate";
import { falConnected } from "@/lib/fal";
import { probeVideo } from "@/lib/video/probe";
import { renderFableClip } from "@/lib/video/render";
import { buildSfxEvents, type SfxEvent } from "@/lib/video/sfx";
import { cachedTts } from "@/lib/video/tts-cache";
import { transcribe, type Transcript, type TranscriptWord } from "@/lib/video/transcribe";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const update = (id: string, data: Prisma.VideoJobUpdateInput) =>
  db.videoJob.update({ where: { id }, data });

export async function processFablePrep(job: VideoJob): Promise<void> {
  const projectId = job.fableProjectId;
  try {
    if (!projectId) throw new Error("Prep job has no project.");
    const sources = await db.fableSource.findMany({
      where: { projectId },
      orderBy: { index: "asc" },
    });
    if (!sources.length) throw new Error("The project has no sources.");

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const pct = 5 + Math.round((i / sources.length) * 90);
      await update(job.id, {
        status: "transcribing",
        stage: `Reading source ${i + 1}/${sources.length}`,
        progress: pct,
      });
      try {
        const asset = await db.mediaAsset.findUnique({ where: { id: source.assetId } });
        if (!asset) throw new Error("Source media is missing from storage.");
        if (asset.mimeType.startsWith("image/")) {
          // Photos: nothing to probe or transcribe. Their usable duration is
          // the animation window scenes trim within (animated at render time).
          await db.fableSource.update({
            where: { id: source.id },
            data: {
              durationSecs: PHOTO_ANIMATE_MS / 1000,
              hasAudio: false,
              transcript: JSON.stringify({ text: "", words: [] }),
              status: "ready",
            },
          });
          continue;
        }
        const path = localFilePath({
          storageDriver: asset.storageDriver as "local" | "s3",
          storagePath: asset.storagePath,
        });
        const probe = await probeVideo(path);
        // Tolerant: b-roll with music-only/ambient audio legitimately has no
        // timed words — it must not fail the whole prep.
        let transcript: Transcript = { text: "", words: [] };
        if (probe.hasAudio) {
          try {
            transcript = await transcribe(path);
          } catch {
            /* silent source — no dialogue captions */
          }
        }
        await db.fableSource.update({
          where: { id: source.id },
          data: {
            width: probe.width,
            height: probe.height,
            durationSecs: probe.durationSecs,
            hasAudio: probe.hasAudio,
            transcript: JSON.stringify(transcript),
            status: "ready",
          },
        });
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { width: probe.width, height: probe.height, durationSecs: probe.durationSecs },
        });
      } catch (err) {
        await db.fableSource.update({
          where: { id: source.id },
          data: { status: "failed" },
        });
        throw new Error(`Source ${i + 1} ("${source.assetId}") failed: ${msg(err)}`);
      }
    }

    await db.fableProject.update({
      where: { id: projectId },
      data: { status: "ready", errorMessage: null },
    });
    await update(job.id, { status: "complete", progress: 100, stage: "Footage read — the Director is ready." });
  } catch (err) {
    if (projectId) {
      await db.fableProject
        .update({ where: { id: projectId }, data: { status: "failed", errorMessage: msg(err) } })
        .catch(() => {});
    }
    await update(job.id, { status: "failed", errorMessage: msg(err), stage: "Failed" });
  }
}

// ─── Render: execute a frozen FablePlan ──────────────────────────────────────

// Once a music search resolves into a concrete composed track, pin it
// everywhere the plan lives (this job, its revision, and the project's working
// plan if the query is unchanged) so refinements keep the same music.
async function pinResolvedMusic(job: VideoJob, plan: FablePlan, assetId: string): Promise<void> {
  const pinned = { ...plan, music: { ...plan.music, mode: "asset" as const, assetId, query: "" } };
  const json = JSON.stringify(pinned);
  await update(job.id, { fablePlan: json });
  await db.fableRevision.updateMany({ where: { jobId: job.id }, data: { plan: json } });
  if (job.fableProjectId) {
    const project = await db.fableProject.findUnique({ where: { id: job.fableProjectId } });
    if (project?.plan) {
      try {
        const working = JSON.parse(project.plan) as FablePlan;
        if (working.music.mode === "search" && working.music.query === plan.music.query) {
          working.music = { ...working.music, mode: "asset", assetId, query: "" };
          await db.fableProject.update({
            where: { id: project.id },
            data: { plan: JSON.stringify(working) },
          });
        }
      } catch {
        /* leave the working plan untouched */
      }
    }
  }
}

export async function processFableRender(job: VideoJob): Promise<void> {
  const tmpDir = path.join(process.cwd(), "uploads", "tmp");
  let voPath = "";
  try {
    if (!job.fablePlan) throw new Error("Render job has no plan.");
    const plan = JSON.parse(job.fablePlan) as FablePlan;
    const sources = await db.videoSource.findMany({
      where: { jobId: job.id },
      orderBy: { index: "asc" },
    });
    if (!sources.length) throw new Error("Render job has no sources.");

    await update(job.id, { status: "probing", stage: "Setting up the cut", progress: 5 });
    const sourcePaths: string[] = [];
    const sourceMimes: string[] = [];
    const wordsBySource: TranscriptWord[][] = [];
    const sourceHasAudio: boolean[] = [];
    for (const s of sources) {
      const asset = await db.mediaAsset.findUnique({ where: { id: s.assetId } });
      if (!asset) throw new Error(`Source ${s.index} is missing from storage.`);
      sourcePaths.push(
        localFilePath({ storageDriver: asset.storageDriver as "local" | "s3", storagePath: asset.storagePath })
      );
      sourceMimes.push(asset.mimeType);
      const isPhoto = asset.mimeType.startsWith("image/");
      let words: TranscriptWord[] = [];
      if (!isPhoto && s.transcript) {
        try {
          words = (JSON.parse(s.transcript) as Transcript).words ?? [];
        } catch {
          /* silent source */
        }
      }
      wordsBySource.push(words);
      sourceHasAudio.push(!isPhoto && (words.length > 0 || (await hasAudioStream(s.assetId))));
    }

    // 0. Photo scenes → animated footage. One i2v render per distinct
    //    (photo, motion) pair (content-hash cached), spliced in as a new
    //    source; the scene then trims within it like uploaded footage. An
    //    animated photo is core content: failures fail the job loudly.
    const photoScenes = plan.scenes.filter((sc) => sourceMimes[sc.sourceIndex]?.startsWith("image/"));
    if (photoScenes.length) {
      const animationLog: Record<string, unknown>[] = [];
      const byKey = new Map<string, number>(); // photoIdx|motion → new source index
      let animated = 0;
      for (const scene of plan.scenes) {
        if (!sourceMimes[scene.sourceIndex]?.startsWith("image/")) continue;
        const key = `${scene.sourceIndex}|${scene.motion}`;
        let newIndex = byKey.get(key);
        if (newIndex === undefined) {
          animated++;
          await update(job.id, { status: "planning", stage: `Bringing photo ${animated} to life`, progress: 8 });
          const anim = await resolveAnimation({
            photoPath: sourcePaths[scene.sourceIndex],
            photoMime: sourceMimes[scene.sourceIndex],
            motion: scene.motion,
            userId: job.userId,
            jobId: job.id,
          });
          newIndex = sourcePaths.length;
          sourcePaths.push(anim.path);
          sourceMimes.push("video/mp4");
          wordsBySource.push([]);
          sourceHasAudio.push(false);
          await db.videoSource.create({
            data: { jobId: job.id, index: newIndex, assetId: anim.assetId, durationSecs: anim.durationSecs },
          });
          byKey.set(key, newIndex);
          animationLog.push({ kind: "animate", cached: anim.cached, engine: anim.engine, photoSource: scene.sourceIndex });
        }
        scene.sourceIndex = newIndex;
        // The animated clip may run slightly longer than the window (engine
        // rounding); clamp the trim to the delivered file at render time is
        // unnecessary — trims were sanitized within PHOTO_ANIMATE_MS.
      }
      if (animationLog.length) {
        const prior = job.renderLog ? (JSON.parse(job.renderLog) as unknown[]) : [];
        await update(job.id, { renderLog: JSON.stringify([...prior, ...animationLog]) });
      }
    }

    // 1. Music: resolve a search into a pinned asset; detect beats when synced.
    let musicPath: string | undefined;
    if (plan.music.mode === "search" && plan.music.query) {
      // Eleven Music composes an original track sized to the cut — the only
      // music engine. The result is pinned, so refinements and draft->final
      // keep the exact same track.
      const engine = await musicEngine();
      if (!engine) throw new Error("No music engine connected — add ElevenLabs on the Connections page.");
      await update(job.id, { status: "planning", stage: "Composing the score", progress: 15 });
      const timelineMs = planTimelineMs(plan);
      const saved = await composeMusicAsset(plan.music.query, timelineMs + 2000, job.userId);
      plan.music = { ...plan.music, mode: "asset", assetId: saved.assetId, query: "" };
      await pinResolvedMusic(job, { ...plan, music: { ...plan.music } }, saved.assetId);
    }
    if (plan.music.mode === "asset" && plan.music.assetId) {
      const musicAsset = await db.mediaAsset.findUnique({ where: { id: plan.music.assetId } });
      if (!musicAsset) throw new Error("The pinned music track is missing from the library.");
      musicPath = localFilePath({
        storageDriver: musicAsset.storageDriver as "local" | "s3",
        storagePath: musicAsset.storagePath,
      });
    }
    let beat: BeatInfo | null = null;
    if (plan.music.beatSync && musicPath) {
      await update(job.id, { status: "planning", stage: "Feeling the beat", progress: 22 });
      beat = await detectBeats(musicPath);
    }

    // 2. Voice-over via the TTS cache. The fit check counts SCENES ONLY —
    //    bridge time is bonus breathing room, so a morph that degrades to a
    //    shorter dissolve can never starve the narration.
    const clip = planToEdlClip(plan);
    const sceneOnlyMs = plan.scenes.reduce((a, s) => a + Math.round((s.endMs - s.startMs) / (s.speed || 1)), 0);
    let vo: { path: string; words: TranscriptWord[]; durationMs: number } | undefined;
    if (plan.voiceover.enabled) {
      await update(job.id, { status: "planning", stage: "Narrating (ElevenLabs)", progress: 30 });
      const tts = await cachedTts(plan.voiceover.script, plan.voiceover.voiceId || undefined);
      if (tts.durationMs > sceneOnlyMs + 600) {
        throw new Error(
          "The narration reads longer than the cut — ask the Director to shorten the script or lengthen the edit."
        );
      }
      await fs.mkdir(tmpDir, { recursive: true });
      voPath = path.join(tmpDir, `${randomUUID()}.mp3`);
      await fs.writeFile(voPath, tts.buffer);
      vo = { path: voPath, words: tts.words, durationMs: tts.durationMs };
    }

    // 2b. Bridges: materialize dissolve/morph transitions as first-class muted
    //     scenes spliced between the real ones — the concat architecture and
    //     the timeline model then need no special cases. Serves the Director
    //     AND ad films (both arrive here as frozen plans).
    let execSegments = clip.segments;
    let execSceneAudio: ("dialogue" | "mute")[] = plan.scenes.map((s) => s.audio);
    let execBeatDurations = beat
      ? buildBeatDurations(beat, plan.music.beatCadence, clip.segments.length)
      : undefined;
    const bridgeWanted = plan.scenes.map((s, i) => i > 0 && (s.transition === "morph" || s.transition === "dissolve"));
    if (bridgeWanted.some(Boolean)) {
      const provisional = buildTimeline(clip.segments, execBeatDurations);
      const aiAllowed = !job.draft && (await falConnected());
      let aiSpent = 0;
      const outSegments: typeof clip.segments = [];
      const outAudio: ("dialogue" | "mute")[] = [];
      const outBeats: number[] = [];
      const bridgeLog: Record<string, unknown>[] = [];
      for (let i = 0; i < clip.segments.length; i++) {
        if (bridgeWanted[i]) {
          const prev = provisional[i - 1];
          const next = provisional[i];
          const wantAi = plan.scenes[i].transition === "morph" && aiAllowed && aiSpent < MORPH_MAX_PER_RENDER;
          if (wantAi) {
            await update(job.id, { status: "planning", stage: `Generating morph bridge ${aiSpent + 1}`, progress: 36 });
          }
          // A transition is decoration: ANY failure in the bridge attempt
          // (frame extraction included) degrades to a hard cut — never the job.
          let frameA = "";
          let frameB = "";
          try {
            // Frames come from the CLAMPED trim points, pre-cropped to 9:16, so
            // the bridge's endpoints match the rendered frames either side.
            frameA = await extractStyledFrame(sourcePaths[prev.sourceIndex], prev.srcEndMs - 33);
            frameB = await extractStyledFrame(sourcePaths[next.sourceIndex], next.srcStartMs);
            const bridge = await resolveBridge({
              framePathA: frameA,
              framePathB: frameB,
              useAi: wantAi,
              userId: job.userId,
              jobId: job.id,
            });
            if (bridge.kind === "morph" && !bridge.cached) aiSpent++;
            const bridgeIdx = sourcePaths.length;
            sourcePaths.push(bridge.path);
            wordsBySource.push([]);
            sourceHasAudio.push(false);
            await db.videoSource.create({
              data: { jobId: job.id, index: bridgeIdx, assetId: bridge.assetId, durationSecs: bridge.durationSecs },
            });
            const durMs = Math.round(bridge.durationSecs * 1000);
            // Morph bridges (4s Seedance minimum) play time-compressed to the
            // standard bridge length; dissolves are already the right length.
            const speed = bridge.kind === "morph" ? Math.min(4, durMs / MORPH_BRIDGE_OUT_MS) : 1;
            outSegments.push({ sourceIndex: bridgeIdx, startMs: 0, endMs: durMs, effect: "none", speed });
            outAudio.push("mute");
            outBeats.push(0); // bridges are never beat-clamped
            bridgeLog.push({ kind: bridge.kind, cached: bridge.cached, intoScene: i, engine: bridge.kind === "morph" ? "seedance" : "ffmpeg" });
          } catch (err) {
            console.error("[fable] bridge failed, using a hard cut:", msg(err));
            bridgeLog.push({ kind: "skipped", intoScene: i, reason: msg(err).slice(0, 160) });
          } finally {
            if (frameA) await fs.unlink(frameA).catch(() => {});
            if (frameB) await fs.unlink(frameB).catch(() => {});
          }
        }
        outSegments.push(clip.segments[i]);
        outAudio.push(plan.scenes[i].audio);
        outBeats.push(execBeatDurations?.[i] ?? 0);
      }
      execSegments = outSegments;
      execSceneAudio = outAudio;
      execBeatDurations = execBeatDurations ? outBeats : undefined;
      if (bridgeLog.length) {
        const prior = job.renderLog ? (JSON.parse(job.renderLog) as unknown[]) : [];
        await update(job.id, { renderLog: JSON.stringify([...prior, ...bridgeLog]) });
      }
    }
    const execClip = { ...clip, segments: execSegments };

    // 3. Decorations: emoji pops + SFX (intensity-gated). One timeline —
    //    identical inputs to the renderer's own buildTimeline, so overlay
    //    positions and ffmpeg agree by construction.
    const segDurationsMs = execBeatDurations;
    const tl = buildTimeline(execClip.segments, segDurationsMs);
    const emojiWords = vo ? vo.words : wordsBySource.flat();
    const emojiOverlays = plan.captions
      ? await buildEmojiOverlays(
          vo ? pseudoTimeline(timelineOutDurMs(tl)) : tl,
          vo ? () => vo!.words : (e) => wordsBySource[e.sourceIndex] ?? [],
          emojiWords.length ? plan.emojiHints : []
        )
      : [];
    let sfx: SfxEvent[] = [];
    if (plan.sfxIntensity !== "off") {
      sfx = await buildSfxEvents(tl);
      if (plan.sfxIntensity === "subtle") sfx = sfx.filter((_, i) => i % 2 === 0);
    }

    // 4. Render + store.
    const row = await db.generatedClip.create({
      data: {
        jobId: job.id,
        kind: "reel",
        rank: 1,
        title: plan.title,
        hook: plan.hook,
        caption: plan.postCaption || null,
        voScript: plan.voiceover.enabled ? plan.voiceover.script : null,
        edl: job.fablePlan,
        status: "rendering",
        keywords: JSON.stringify(plan.keywords),
      },
    });
    await update(job.id, {
      status: "rendering",
      stage: job.draft ? "Rendering the preview" : "Rendering in full quality",
      progress: 45,
    });
    try {
      const tmp = await renderFableClip(sourcePaths, execClip, wordsBySource, {
        captionStyle: plan.captionStyle,
        keywords: plan.keywords,
        burnCaptions: plan.captions,
        musicPath,
        beatDurationsMs: segDurationsMs,
        musicStartSec: beat?.firstBeatSec,
        sfx,
        emojiOverlays,
        vo,
        sceneAudio: execSceneAudio,
        sourceHasAudio,
        draft: job.draft,
      });
      const buffer = await fs.readFile(tmp);
      await fs.unlink(tmp).catch(() => {});
      const stored = await getStorage().save(buffer, ".mp4");
      const asset = await db.mediaAsset.create({
        data: {
          userId: job.userId, // rendered cut lands in the job owner's library
          originalName: `${plan.title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "cut"}${job.draft ? "-preview" : ""}.mp4`,
          mimeType: "video/mp4",
          sizeBytes: buffer.length,
          storageDriver: stored.storageDriver,
          storagePath: stored.storagePath,
        },
      });
      await db.generatedClip.update({
        where: { id: row.id },
        data: { status: "rendered", assetId: asset.id, errorMessage: null },
      });
    } catch (err) {
      await db.generatedClip.update({
        where: { id: row.id },
        data: { status: "failed", errorMessage: msg(err) },
      });
      throw err;
    }

    await update(job.id, {
      status: "complete",
      progress: 100,
      stage: job.draft ? "Preview ready." : "Final cut rendered.",
    });
  } catch (err) {
    await update(job.id, { status: "failed", errorMessage: msg(err), stage: "Failed" });
  } finally {
    if (voPath) await fs.unlink(voPath).catch(() => {});
  }
}

// A silent source may still have an audio stream (room tone) — cheap probe check
// so the renderer knows whether it can pull [idx:a] or must synthesise silence.
async function hasAudioStream(assetId: string): Promise<boolean> {
  const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) return false;
  try {
    const probe = await probeVideo(
      localFilePath({ storageDriver: asset.storageDriver as "local" | "s3", storagePath: asset.storagePath })
    );
    return probe.hasAudio;
  } catch {
    return false;
  }
}
