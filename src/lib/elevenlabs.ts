// ElevenLabs client: voice-over TTS (with word timings) and sound-effect
// generation for the Studio render pipeline. Server/worker-side only — audio
// bytes are mixed into renders by ffmpeg, never sent to the browser raw.
//
// Endpoints (verified against the ElevenLabs docs, 2026-07):
//   POST /v1/text-to-speech/{voice_id}/with-timestamps → audio + char alignment
//   POST /v1/sound-generation                          → audio bytes (0.5-30s)
//   GET  /v1/voices                                    → account voice list

import { getSecrets } from "@/lib/connections";
import type { TranscriptWord } from "@/lib/video/transcribe";

const API_BASE = "https://api.elevenlabs.io/v1";

// A well-known ElevenLabs premade voice (available on every account) so voice-over
// works before the owner picks a voice. Overridden by the connection's voiceId.
const FALLBACK_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // "Rachel"

const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2";
const SFX_MODEL = process.env.ELEVENLABS_SFX_MODEL || "eleven_text_to_sound_v2";

async function apiKeyAndVoice(): Promise<{ apiKey: string; voiceId: string }> {
  const secrets = await getSecrets("elevenlabs");
  if (!secrets?.apiKey) {
    throw new Error("ElevenLabs isn't connected yet — add your API key on the Connections page.");
  }
  return { apiKey: secrets.apiKey, voiceId: secrets.voiceId?.trim() || FALLBACK_VOICE_ID };
}

async function elFetch(path: string, apiKey: string, json: unknown): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(json),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status} on ${path}: ${detail.slice(0, 300)}`);
  }
  return res;
}

export interface VoiceoverAudio {
  buffer: Buffer; // mp3 44.1kHz
  words: TranscriptWord[]; // word timings derived from the character alignment
  durationMs: number;
}

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Collapse ElevenLabs' character-level alignment into word-level timings. */
function wordsFromAlignment(a: Alignment): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let text = "";
  let startMs = 0;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (/\s/.test(ch)) {
      if (text) {
        words.push({ text, startMs, endMs: Math.round(a.character_end_times_seconds[i - 1] * 1000) });
        text = "";
      }
      continue;
    }
    if (!text) startMs = Math.round(a.character_start_times_seconds[i] * 1000);
    text += ch;
  }
  if (text) {
    words.push({
      text,
      startMs,
      endMs: Math.round(a.character_end_times_seconds[a.characters.length - 1] * 1000),
    });
  }
  return words;
}

/**
 * Synthesize a voice-over and return the audio plus word-level timings — the
 * captions burned over a VO come straight from this alignment (no separate STT pass,
 * no drift).
 */
export async function ttsWithTimestamps(text: string, voiceIdOverride?: string): Promise<VoiceoverAudio> {
  const { apiKey, voiceId } = await apiKeyAndVoice();
  const voice = voiceIdOverride?.trim() || voiceId;
  const res = await elFetch(`/text-to-speech/${encodeURIComponent(voice)}/with-timestamps`, apiKey, {
    text,
    model_id: TTS_MODEL,
    output_format: "mp3_44100_128",
  });
  const data = (await res.json()) as { audio_base64?: string; alignment?: Alignment };
  if (!data.audio_base64 || !data.alignment) {
    throw new Error("ElevenLabs returned no audio/alignment — check the account's TTS quota.");
  }
  const words = wordsFromAlignment(data.alignment);
  const last = words[words.length - 1];
  return {
    buffer: Buffer.from(data.audio_base64, "base64"),
    words,
    durationMs: last ? last.endMs : 0,
  };
}

/** Generate one sound effect (0.5-30s) from a text prompt. Returns mp3 bytes. */
export async function generateSfx(prompt: string, durationSeconds?: number): Promise<Buffer> {
  const { apiKey } = await apiKeyAndVoice();
  const res = await elFetch("/sound-generation", apiKey, {
    text: prompt,
    model_id: SFX_MODEL,
    ...(durationSeconds ? { duration_seconds: Math.min(Math.max(durationSeconds, 0.5), 30) } : {}),
  });
  return Buffer.from(await res.arrayBuffer());
}

export interface ElevenVoice {
  id: string;
  name: string;
  labels?: Record<string, string>;
}

/** The account's voice list, for the Studio voice picker. */
export async function listVoices(): Promise<ElevenVoice[]> {
  const { apiKey } = await apiKeyAndVoice();
  const res = await fetch(`${API_BASE}/voices`, { headers: { "xi-api-key": apiKey } });
  if (!res.ok) throw new Error(`ElevenLabs voices request failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { voices?: { voice_id: string; name?: string; labels?: Record<string, string> }[] };
  return (data.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name ?? v.voice_id, labels: v.labels }));
}

/**
 * Eleven Music: compose an original track from a text prompt. Commercially
 * cleared output on paid plans. Needs the `music_generation` permission on
 * the API key — we surface ElevenLabs' own message when it's missing.
 */
export async function generateMusic(prompt: string, lengthMs: number): Promise<Buffer> {
  const secrets = await getSecrets("elevenlabs");
  if (!secrets?.apiKey) {
    throw new Error("ElevenLabs isn't connected yet — see the Connections page.");
  }
  const clamped = Math.max(10_000, Math.min(300_000, Math.round(lengthMs)));
  const res = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: { "xi-api-key": secrets.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, music_length_ms: clamped }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (text.includes("missing_permissions")) {
      throw new Error(
        "Your ElevenLabs key can't compose music yet — edit the key in the ElevenLabs dashboard and enable the Music permission."
      );
    }
    throw new Error(`Eleven Music failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
