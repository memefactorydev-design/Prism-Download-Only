// Ad-film worker stage: generate a multi-segment AI video ad and stitch it
// into one final cut. The ad-video-director-agent plans segments (each within
// the engine's HARD per-render time limit — recorded per render in
// VideoJob.renderLog) plus a voice-over script; segments render on Seedance
// (fal, primary) with Veo (Gemini) as the per-segment backup; the frozen plan
// then runs through the fable executor, which concatenates the segments and
// adds the ElevenLabs voice-over with word-synced captions.

import type { Prisma, VideoJob } from "@prisma/client";
import { db } from "@/lib/db";
import { runAgent } from "@/lib/agents/run-agent";
import { saveGeneratedAsset } from "@/lib/adstudio";
import { getSecrets } from "@/lib/connections";
import { falConnected, falVideo, planVideoEngine, SEEDANCE_MAX_SECS, SEEDANCE_MIN_SECS } from "@/lib/fal";
import { startVeoVideo, veoStatus } from "@/lib/gemini";
import { readMediaFile } from "@/lib/media";
import { DEFAULT_CAPTION_STYLE } from "@/lib/video/caption-styles";
import { cachedTts } from "@/lib/video/tts-cache";
import { probeVideo } from "@/lib/video/probe";
import { localFilePath } from "@/lib/storage";
import { meterUsage } from "@/lib/events";
import type { FablePlan } from "@/lib/fable";
import { processFableRender } from "@/worker/process-fable";

const VEO_MAX_SECS = 8; // Veo 3.1 renders fixed-length ~8s clips

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const update = (id: string, data: Prisma.VideoJobUpdateInput) =>
  db.videoJob.update({ where: { id }, data });

export interface AdFilmBrief {
  prompt: string; // the ad brief (offer, audience, platform, tone)
  targetSecs: number; // desired total runtime
  imageAssetId?: string; // optional: the owner's photo opens segment 1
  title?: string;
}

interface SegmentPlan {
  prompt: string;
  seconds: number;
  transition?: "cut" | "morph";
}
interface FilmPlanPayload {
  segments: SegmentPlan[];
  voScript: string;
  hook: string;
  postCaption: string;
}

const FILM_PLAN_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      description: "The ordered shot list — one video-generation prompt per segment.",
      items: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Self-contained generation prompt with the shared style block." },
          seconds: { type: "integer", description: "Segment length in seconds — MUST be within the per-render limit." },
          transition: {
            type: "string",
            enum: ["cut", "morph"],
            description:
              "How this segment ENTERS: cut (default), or morph — a ~1.3s AI-generated bridge that transforms the previous segment's closing frame into this one's opening frame (one extra AI render, ~$1; max 2 per film; segment 1 must be cut). Use it when consecutive segments show different subjects or locations so the film flows as one piece.",
          },
        },
        required: ["prompt", "seconds", "transition"],
        additionalProperties: false,
      },
    },
    voScript: { type: "string", description: "The narration, read verbatim, sized to the total runtime." },
    hook: { type: "string", description: "The first-seconds hook, written out." },
    postCaption: { type: "string", description: "Ready-to-post caption + hashtags for the ad." },
  },
  required: ["segments", "voScript", "hook", "postCaption"],
  additionalProperties: false,
};

interface RenderLogEntry {
  index: number;
  engine: string; // "kling" | "seedance" (plan-routed) | "veo" (backup)
  capSecs: number; // the engine's hard per-render time limit at render time
  requestedSecs: number;
  actualSecs: number; // probed from the delivered file
}

/** Render one segment: the plan's fal engine first (Kling on lower tiers,
 *  Seedance on upper), Veo as the backup engine. Segments are rendered WITHOUT
 *  generated audio — the ElevenLabs VO is the soundtrack. */
async function renderSegment(
  prompt: string,
  seconds: number,
  firstFrame: { mime: string; buffer: Buffer } | undefined,
  seedanceAvailable: boolean
): Promise<{ buffer: Buffer; engine: string; capSecs: number }> {
  if (seedanceAvailable) {
    try {
      const buffer = await falVideo(prompt, firstFrame, seconds, "9:16", false);
      return { buffer, engine: planVideoEngine(), capSecs: SEEDANCE_MAX_SECS };
    } catch (err) {
      console.error("[adfilm] fal segment failed, falling back to Veo:", msg(err));
    }
  }
  const op = await startVeoVideo(prompt, firstFrame, "9:16");
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("Veo timed out rendering a segment.");
    await new Promise((r) => setTimeout(r, 10_000));
    const status = await veoStatus(op);
    if (!status.done) continue;
    if (status.error || !status.buffer) throw new Error(status.error ?? "Veo returned no video for a segment.");
    return { buffer: status.buffer, engine: "veo", capSecs: VEO_MAX_SECS };
  }
}

export async function processAdFilm(job: VideoJob): Promise<void> {
  try {
    if (!job.voBrief) throw new Error("Ad-film job has no brief.");
    const brief = JSON.parse(job.voBrief) as AdFilmBrief;
    if (!brief.prompt?.trim()) throw new Error("Ad-film brief has no prompt.");

    // ElevenLabs is the app's one VO/caption engine — required, fail loudly.
    if (!(await getSecrets("elevenlabs"))) {
      throw new Error("ElevenLabs isn't connected — the ad film's voice-over and captions need it. Add it on the Connections page.");
    }

    const seedanceAvailable = await falConnected();
    const capSecs = seedanceAvailable ? SEEDANCE_MAX_SECS : VEO_MAX_SECS;
    const targetSecs = Math.max(SEEDANCE_MIN_SECS, Math.min(90, Math.round(brief.targetSecs || 24)));

    // 1. Direction: the agent writes the shot list + VO script.
    await update(job.id, { status: "planning", stage: "Directing the shots", progress: 5 });
    const task = [
      `Design a ${targetSecs}-second vertical video ad as a sequence of AI-generated segments.`,
      `HARD per-render time limit: ${capSecs} seconds per segment — no segment may exceed it. Prefer segments of ${Math.min(6, capSecs)}-${capSecs}s.`,
      brief.imageAssetId ? "Segment 1 opens on the owner's real photo (image-to-video) — design its motion FROM a still frame." : "",
      "",
      "## The ad brief",
      brief.prompt.trim().slice(0, 6000),
    ].join("\n");
    const { data } = await runAgent<FilmPlanPayload>("ad-video-director-agent", task, {
      schema: FILM_PLAN_SCHEMA,
      reportKind: "video_production",
      reportTitle: `Ad film direction: ${brief.title ?? brief.prompt.slice(0, 60)}`,
      scopeUserId: job.userId,
    });
    if (!data?.segments?.length) throw new Error("ad-video-director-agent returned no segments.");
    if (!data.voScript?.trim()) throw new Error("ad-video-director-agent returned no voice-over script.");

    // 2. Record the voice-over FIRST (it lands in the TTS cache, so the final
    //    render reuses it — no double spend) and size the timeline to it: TTS
    //    pace varies, so segment lengths stretch (within the per-render cap)
    //    until the cut is long enough for the narration.
    await update(job.id, { status: "planning", stage: "Recording the voice-over", progress: 8 });
    const voScript = data.voScript.trim();
    const vo = await cachedTts(voScript, job.voVoiceId || undefined);
    const plannedSecs = data.segments.map((s) => Math.max(SEEDANCE_MIN_SECS, Math.min(capSecs, Math.round(s.seconds))));
    const neededSecs = (vo.durationMs + 1200) / 1000;
    let plannedTotal = plannedSecs.reduce((a, b) => a + b, 0);
    for (let guard = 0; plannedTotal < neededSecs && guard < 64; guard++) {
      // Round-robin +1s onto the segment furthest from its cap.
      const i = plannedSecs.indexOf(Math.min(...plannedSecs));
      if (plannedSecs[i] >= capSecs) break;
      plannedSecs[i] += 1;
      plannedTotal = plannedSecs.reduce((a, b) => a + b, 0);
    }
    if (plannedTotal < neededSecs) {
      throw new Error(
        `The narration runs ${Math.round(vo.durationMs / 1000)}s but the segments can cover at most ${plannedTotal}s (${data.segments.length} renders × ${capSecs}s cap) — shorten the brief or pick a longer target.`
      );
    }

    // 3. Render each segment — Seedance primary, Veo backup; log every render's
    //    engine + time limit so the stitch is auditable.
    let firstFrame: { mime: string; buffer: Buffer } | undefined;
    if (brief.imageAssetId) {
      const file = await readMediaFile(brief.imageAssetId);
      if (file?.asset.mimeType.startsWith("image/")) firstFrame = { mime: file.asset.mimeType, buffer: file.buffer };
    }

    const renderLog: RenderLogEntry[] = [];
    const sceneDurationsMs: number[] = [];
    for (let i = 0; i < data.segments.length; i++) {
      const seg = data.segments[i];
      const requestedSecs = plannedSecs[i];
      const pct = 10 + Math.round((i / data.segments.length) * 55);
      await update(job.id, {
        status: "rendering",
        stage: `Rendering segment ${i + 1}/${data.segments.length} (≤${capSecs}s per render)`,
        progress: pct,
      });
      const rendered = await renderSegment(seg.prompt, requestedSecs, i === 0 ? firstFrame : undefined, seedanceAvailable);
      const asset = await saveGeneratedAsset(
        rendered.buffer,
        "video/mp4",
        `${brief.title ?? "Ad film"} — segment ${i + 1}`,
        job.userId
      );
      const probe = await probeVideo(
        localFilePath({ storageDriver: asset.storageDriver as "local" | "s3", storagePath: asset.storagePath })
      );
      await db.videoSource.create({
        data: {
          jobId: job.id,
          index: i,
          assetId: asset.id,
          width: probe.width,
          height: probe.height,
          durationSecs: probe.durationSecs,
        },
      });
      renderLog.push({
        index: i,
        engine: rendered.engine,
        capSecs: rendered.capSecs,
        requestedSecs,
        actualSecs: Math.round(probe.durationSecs * 10) / 10,
      });
      sceneDurationsMs.push(Math.round(probe.durationSecs * 1000));
      await update(job.id, { renderLog: JSON.stringify(renderLog) });
      meterUsage(job.userId, "video_gen", 1, { engine: rendered.engine, capSecs: rendered.capSecs, jobId: job.id, segment: i });
    }

    // Backup renders can come back shorter than requested (Veo is ~8s fixed) —
    // catch an undershoot here with an actionable message instead of letting
    // the stitch fail opaquely.
    const actualTotalMs = sceneDurationsMs.reduce((a, b) => a + b, 0);
    if (actualTotalMs < vo.durationMs + 600) {
      throw new Error(
        `The rendered segments total ${Math.round(actualTotalMs / 1000)}s but the narration needs ${Math.round(vo.durationMs / 1000)}s — a backup render came back shorter than planned. Run it again (segments re-render) or shorten the brief.`
      );
    }

    // 4. Freeze the stitch plan and hand it to the fable executor: ONE
    //    interleaved concat, ElevenLabs VO (already cached) + word-synced
    //    captions. Segments are silent by design — the narration carries it.
    let morphCount = 0;
    const plan: FablePlan = {
      version: 1,
      title: brief.title ?? "Ad film",
      summary: `AI ad film: ${data.segments.length} segments stitched, narrated and captioned.`,
      hook: data.hook,
      postCaption: data.postCaption,
      targetDurationMs: sceneDurationsMs.reduce((a, b) => a + b, 0),
      aspect: "9:16",
      captions: true,
      captionStyle: DEFAULT_CAPTION_STYLE,
      keywords: [],
      emojiHints: [],
      scenes: data.segments.map((seg, i) => {
        // The agent's morph choices ride into the frozen plan (capped 2, first
        // segment always a cut); processFableRender materializes the bridges.
        morphCount += i > 0 && seg.transition === "morph" ? 1 : 0;
        return {
          sourceIndex: i,
          startMs: 0,
          endMs: sceneDurationsMs[i],
          motion: "", // segments are already live footage
          effect: "none" as const,
          audio: "mute" as const, // segments render silent — the VO is the soundtrack
          captionNote: "",
          speed: 1,
          transition: (i > 0 && seg.transition === "morph" && morphCount <= 2 ? "morph" : "cut") as "morph" | "cut",
        };
      }),
      music: { mode: "none", query: "", assetId: "", beatSync: false, beatCadence: 2 },
      voiceover: { enabled: true, script: voScript, voiceId: job.voVoiceId ?? "" },
      sfxIntensity: "off",
    };
    await update(job.id, {
      fablePlan: JSON.stringify(plan),
      stage: "Stitching the final cut",
      progress: 70,
    });
    const frozen = await db.videoJob.findUnique({ where: { id: job.id } });
    if (!frozen) throw new Error("Job vanished mid-render.");
    await processFableRender(frozen);
  } catch (err) {
    console.error(`[adfilm] job ${job.id} failed:`, err);
    await update(job.id, { status: "failed", stage: "Failed", errorMessage: msg(err) });
  }
}
