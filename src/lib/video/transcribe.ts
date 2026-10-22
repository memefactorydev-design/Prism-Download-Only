// Transcription with word-level timestamps via ElevenLabs Scribe — the app's
// one speech engine for VO, captions AND transcription (owner's instruction
// 2026-07-12; replaced the local Whisper/Transformers.js path, so source audio
// IS sent to ElevenLabs for this step). Fail-loudly when the connection is
// missing — captions and clip planning need real timed words.
//
// Only the worker/pipeline imports this — keep it out of the Next request
// bundle (audio extraction shells out to the bundled ffmpeg).

import { runFfmpeg } from "@/lib/video/ffmpeg";
import { getSecrets } from "@/lib/connections";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
}
export interface Transcript {
  text: string;
  words: TranscriptWord[];
}

const STT_MODEL = process.env.ELEVENLABS_STT_MODEL || "scribe_v2";

// Extract a compact mono mp3 for upload — Scribe accepts audio or video, but
// stripping to 64kbps mono audio keeps multi-GB sources fast to send.
async function extractAudio(absolutePath: string): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `prism-stt-${randomUUID()}.mp3`);
  try {
    await runFfmpeg(["-i", absolutePath, "-vn", "-ac", "1", "-ar", "22050", "-b:a", "64k", tmp]);
    return await fs.readFile(tmp);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

interface ScribeWord {
  text?: string;
  start?: number;
  end?: number;
  type?: string; // "word" | "spacing" | "audio_event"
}
interface ScribeResult {
  text?: string;
  words?: ScribeWord[];
}

export async function transcribe(absolutePath: string): Promise<Transcript> {
  const secrets = await getSecrets("elevenlabs");
  if (!secrets?.apiKey) {
    throw new Error("ElevenLabs isn't connected — transcription (captions + clip planning) needs it. Add it on the Connections page.");
  }
  let audio: Buffer;
  try {
    audio = await extractAudio(absolutePath);
  } catch {
    throw new Error("No audio track found — clips and captions can't be planned without speech.");
  }
  if (audio.length < 1024) {
    throw new Error("No audio track found — clips and captions can't be planned without speech.");
  }

  const form = new FormData();
  form.append("model_id", STT_MODEL);
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "audio.mp3");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": secrets.apiKey },
    body: form,
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs Scribe ${res.status}: ${detail.slice(0, 300)}`);
  }
  const result = (await res.json()) as ScribeResult;

  const words: TranscriptWord[] = [];
  for (const w of result.words ?? []) {
    if (w.type && w.type !== "word") continue; // skip spacing/audio-event entries
    const text = (w.text ?? "").trim();
    if (!text || w.start == null) continue;
    const end = w.end ?? w.start + 0.4;
    words.push({ text, startMs: Math.round(w.start * 1000), endMs: Math.round(end * 1000) });
  }
  const text = (result.text ?? words.map((w) => w.text).join(" ")).trim();
  if (!words.length) {
    throw new Error("Transcription produced no timed words — the audio may be silent or music-only.");
  }
  return { text, words };
}

// Group words into readable timestamped lines (~one phrase) for the planning
// prompt — far fewer tokens than per-word, while keeping accurate in/out times.
export function toSegments(
  words: TranscriptWord[],
  maxLineMs = 5_000,
  gapMs = 700
): { startMs: number; endMs: number; text: string }[] {
  const lines: { startMs: number; endMs: number; text: string }[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({
      startMs: cur[0].startMs,
      endMs: cur[cur.length - 1].endMs,
      text: cur.map((w) => w.text).join(" "),
    });
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
