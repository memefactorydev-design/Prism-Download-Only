// Voice-over TTS cache: keyed on sha256(script + voice), stored under data/tts
// (audio mp3 + word-timing JSON side by side). A draft→final re-render — or any
// refinement that doesn't touch the script — costs zero ElevenLabs credits.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ttsWithTimestamps, type VoiceoverAudio } from "@/lib/elevenlabs";

const TTS_DIR = path.join(process.cwd(), "data", "tts");

export async function cachedTts(script: string, voiceId?: string): Promise<VoiceoverAudio> {
  const key = createHash("sha256").update(`${voiceId ?? ""}\n${script}`).digest("hex").slice(0, 32);
  const audioFile = path.join(TTS_DIR, `${key}.mp3`);
  const metaFile = path.join(TTS_DIR, `${key}.json`);
  try {
    const [buffer, metaRaw] = await Promise.all([fs.readFile(audioFile), fs.readFile(metaFile, "utf8")]);
    const meta = JSON.parse(metaRaw) as Pick<VoiceoverAudio, "words" | "durationMs">;
    return { buffer, words: meta.words, durationMs: meta.durationMs };
  } catch {
    /* miss — synthesize */
  }
  const vo = await ttsWithTimestamps(script, voiceId);
  await fs.mkdir(TTS_DIR, { recursive: true });
  await fs.writeFile(audioFile, vo.buffer);
  await fs.writeFile(metaFile, JSON.stringify({ words: vo.words, durationMs: vo.durationMs }));
  return vo;
}
