// Raw-video ingest for Studio. Unlike /api/media (which buffers the whole file in
// memory via formData — fine for images, fatal for multi-GB podcasts), this streams
// the request body straight to disk, then enqueues a VideoJob for the worker.
// The client sends the file as the raw body with Content-Type + X-Filename headers.

import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { promises as fs } from "node:fs";
import { db } from "@/lib/db";
import { getStorage, localFilePath, UploadTooLargeError } from "@/lib/storage";
import { VIDEO_MIMES } from "@/lib/media";
import { enqueueJob, enqueueVoiceover, STUDIO_OUTPUT_KINDS } from "@/lib/studio";
import { canTouch, getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300; // Vercel Pro cap (Studio rendering runs in the worker, not here)

// Generous cap for source footage (above the 512MB post-media limit) to protect
// the disk; a 1-hour podcast easily runs into the gigabytes.
const MAX_SOURCE_BYTES = 5 * 1024 * 1024 * 1024;
const LIMIT_GB = MAX_SOURCE_BYTES / 1024 / 1024 / 1024;

// Music tracks for music-bed montages (small — but still streamed).
const AUDIO_MIMES: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
};

export async function POST(request: Request): Promise<Response> {
  // Proxy-exempt (streams multi-GB bodies) — so the session is enforced HERE.
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  const params = new URL(request.url).searchParams;
  const isMusic = params.get("kind") === "music";
  const mimeType = (request.headers.get("content-type") || "").split(";")[0].trim();
  const ext = (isMusic ? AUDIO_MIMES : VIDEO_MIMES)[mimeType];
  if (!ext) {
    return Response.json(
      {
        error: isMusic
          ? `Unsupported audio "${mimeType || "unknown"}". Upload an MP3, M4A, WAV or OGG track.`
          : `Unsupported type "${mimeType || "unknown"}". Upload an MP4, MOV or WebM video.`,
      },
      { status: 415 }
    );
  }
  if (!request.body) return Response.json({ error: "The upload was empty." }, { status: 400 });

  // Reject oversized uploads up front when the browser tells us the size, so we
  // never start streaming a file that can't fit under the cap.
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_SOURCE_BYTES) {
    return Response.json(
      {
        error: `That file is ${(declared / 1024 / 1024 / 1024).toFixed(1)} GB — over the ${LIMIT_GB} GB source limit. Trim or compress it first.`,
      },
      { status: 413 }
    );
  }

  const rawName = request.headers.get("x-filename");
  let originalName = `studio-source${ext}`;
  if (rawName) {
    // The client sends the name URI-encoded (headers can't hold non-Latin1 chars).
    try {
      originalName = decodeURIComponent(rawName);
    } catch {
      originalName = rawName;
    }
  }
  const requestedKinds = (params.get("kinds") || "reel")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => (STUDIO_OUTPUT_KINDS as readonly string[]).includes(k));
  const options: {
    captionStyle?: string;
    reframe?: string;
    tightEdit: boolean;
    captions: boolean;
    effects: boolean;
    sfx: boolean;
    blueprint?: string;
    templateTitle?: string;
  } = {
    captionStyle: params.get("captionStyle") ?? undefined,
    reframe: params.get("reframe") ?? undefined,
    tightEdit: params.get("tightEdit") === "1",
    captions: params.get("captions") !== "0",
    effects: params.get("effects") !== "0",
    sfx: params.get("sfx") !== "0",
  };
  // Optional music bed: an already-staged MediaAsset (composed track or upload).
  const musicAssetId = params.get("musicAssetId") || null;
  // Optional: apply a ContentTemplate blueprint so the reel plan follows it.
  const templateId = params.get("templateId");
  if (templateId) {
    const template = await db.contentTemplate.findUnique({ where: { id: templateId } });
    if (template && canTouch(template, user)) {
      options.blueprint = template.blueprint;
      options.templateTitle = template.title;
    }
  }

  // A tapped trend chip steers the cut the same way a template does: the
  // insight's pattern becomes a mini-blueprint for the planner.
  const trendId = params.get("trendId");
  if (trendId && !options.blueprint) {
    const insight = await db.trendInsight.findUnique({ where: { id: trendId } });
    if (insight && canTouch(insight, user)) {
      options.blueprint = [
        `Cut this reel following the trending pattern "${insight.title}" (${insight.platform}).`,
        `Hook style: ${insight.hook}`,
        `Format: ${insight.format}`,
        `Pacing: ${insight.pacing}`,
        insight.whyItWorks ? `Why it works: ${insight.whyItWorks}` : "",
      ].filter(Boolean).join("\n");
      options.templateTitle = `Trend: ${insight.title}`;
    }
  }

  // Stream to disk, aborting the moment the cap is exceeded (Content-Length can be
  // absent or wrong, so this is the real guard — it won't fill the disk).
  const nodeStream = Readable.fromWeb(request.body as unknown as NodeWebReadableStream);
  let stored;
  try {
    stored = await getStorage().saveStream(nodeStream, ext, MAX_SOURCE_BYTES);
  } catch (err) {
    if (err instanceof UploadTooLargeError) {
      return Response.json(
        { error: `That file is over the ${LIMIT_GB} GB source limit. Trim or compress it first.` },
        { status: 413 }
      );
    }
    return Response.json(
      { error: `Upload failed while saving: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const { size } = await fs.stat(localFilePath(stored));
  if (size === 0) {
    await getStorage().delete(stored);
    return Response.json({ error: "The upload was empty." }, { status: 400 });
  }

  const asset = await db.mediaAsset.create({
    data: {
      userId: scope,
      originalName,
      mimeType,
      sizeBytes: size,
      storageDriver: stored.storageDriver,
      storagePath: stored.storagePath,
    },
  });

  // Music tracks and montage sources (defer=1) are staged only — the montage job
  // is created later via /api/studio/montage. Single flow creates the job here.
  if (isMusic || params.get("defer") === "1") {
    return Response.json({ assetId: asset.id, originalName });
  }
  // Voice-over mode: an agent scripts the narration, ElevenLabs reads it.
  if (params.get("mode") === "voiceover") {
    const job = await enqueueVoiceover(
      asset.id,
      {
        ...options,
        voBrief: params.get("voBrief") ?? undefined,
        voVoiceId: params.get("voiceId") ?? undefined,
      },
      musicAssetId,
      scope
    );
    return Response.json({ jobId: job.id, assetId: asset.id });
  }
  const job = await enqueueJob(asset.id, requestedKinds, options, musicAssetId, scope);
  return Response.json({ jobId: job.id, assetId: asset.id });
}
