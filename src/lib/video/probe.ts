// ffprobe wrapper: read a source video's basic shape (duration, dimensions, fps,
// audio presence) so the rest of the pipeline can reason about it and so we can
// backfill MediaAsset.width/height/durationSecs (declared in the schema, unused
// until now).

import { runFfprobe } from "@/lib/video/ffmpeg";

export interface VideoProbe {
  durationSecs: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}
interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

function parseFps(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return null;
  return Math.round((num / den) * 1000) / 1000;
}

export async function probeVideo(absolutePath: string): Promise<VideoProbe> {
  const out = await runFfprobe([
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    absolutePath,
  ]);
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(out.toString()) as FfprobeOutput;
  } catch {
    throw new Error("ffprobe returned unparseable output — is the upload a valid video file?");
  }
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  const durationSecs = Number(parsed.format?.duration ?? 0);
  if (!durationSecs || Number.isNaN(durationSecs)) {
    throw new Error("Could not read a duration from this file — it may be corrupt or not a video.");
  }
  return {
    durationSecs,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseFps(video?.r_frame_rate),
    hasAudio,
  };
}
