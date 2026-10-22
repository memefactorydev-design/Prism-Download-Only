// Beat detection for beat-synced montages. Decodes the music track to mono PCM
// (ffmpeg) and runs music-tempo (Beatroot) to get the tempo + real beat times, so
// montage cuts can be snapped to the beat. Worker-only (ffmpeg + heavy compute);
// returns null on any failure so the caller falls back to un-synced cuts.

import MusicTempo from "music-tempo";
import { runFfmpeg } from "@/lib/video/ffmpeg";

const SR = 44100;

export interface BeatInfo {
  bpm: number;
  beatTimesSec: number[];
  firstBeatSec: number;
}

export async function detectBeats(musicPath: string): Promise<BeatInfo | null> {
  try {
    const raw = await runFfmpeg(
      ["-i", musicPath, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"],
      { captureStdout: true }
    );
    const usable = raw.byteLength - (raw.byteLength % 4);
    if (usable < SR * 4) return null; // < 1s of audio
    const samples = new Float32Array(raw.buffer, raw.byteOffset, usable / 4);
    const mt = new MusicTempo(samples);
    const bpm = Number(mt.tempo);
    const beats = Array.isArray(mt.beats) ? mt.beats.filter((b) => Number.isFinite(b)) : [];
    if (!Number.isFinite(bpm) || bpm <= 0 || beats.length < 4) return null;
    return { bpm: Math.round(bpm), beatTimesSec: beats, firstBeatSec: beats[0] ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Per-segment output durations (ms) from the beat grid — each cut spans
 * `beatsPerCut` beats, taken from consecutive real beat intervals (so cuts land on
 * the beat). Cycles the median once the grid runs out. `count` = number of segments.
 */
export function buildBeatDurations(beat: BeatInfo, beatsPerCut: number, count: number): number[] {
  const beats = beat.beatTimesSec;
  const cuts: number[] = [];
  for (let i = 0; i < beats.length; i += Math.max(1, beatsPerCut)) cuts.push(beats[i]);
  const durs: number[] = [];
  for (let i = 1; i < cuts.length; i++) durs.push(Math.round((cuts[i] - cuts[i - 1]) * 1000));
  const clean = durs.filter((d) => d >= 300);
  if (!clean.length) {
    const d = Math.round((60 / Math.max(60, beat.bpm)) * beatsPerCut * 1000);
    return Array.from({ length: count }, () => d);
  }
  const median = [...clean].sort((a, b) => a - b)[Math.floor(clean.length / 2)];
  return Array.from({ length: count }, (_, i) => (i < clean.length ? clean[i] : median));
}
