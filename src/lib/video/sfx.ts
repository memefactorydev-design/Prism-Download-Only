// Cached sound-effects library. Each effect is generated ONCE via ElevenLabs
// (worker-side) and cached under data/sfx — after that, renders reuse the file
// at zero marginal cost. When ElevenLabs isn't connected, SFX are silently
// skipped: they're decoration, never a render blocker (the Studio UI says so).

import { promises as fs } from "node:fs";
import path from "node:path";
import { generateSfx } from "@/lib/elevenlabs";
import { getSecrets } from "@/lib/connections";
import type { SegmentEffect } from "@/lib/video/edl";
import type { TimelineEntry } from "@/lib/video/timeline";

const SFX_DIR = path.join(process.cwd(), "data", "sfx");

interface SfxDef {
  id: string;
  prompt: string;
  durationSeconds: number;
}

const LIBRARY: Record<string, SfxDef> = {
  whoosh: { id: "whoosh", prompt: "short clean airy whoosh transition, fast, subtle, cinematic", durationSeconds: 0.7 },
  boom: { id: "boom", prompt: "soft deep cinematic boom impact, short, tasteful, not harsh", durationSeconds: 0.9 },
  pop: { id: "pop", prompt: "small satisfying UI pop, single, clean", durationSeconds: 0.5 },
};

// Which library sound accompanies each on-screen effect.
const EFFECT_SFX: Partial<Record<SegmentEffect, string>> = {
  punch_in: "whoosh",
  flash_cut: "boom",
};

async function ensureSfx(id: string): Promise<string | null> {
  const def = LIBRARY[id];
  if (!def) return null;
  const file = path.join(SFX_DIR, `${id}.mp3`);
  try {
    await fs.access(file);
    return file;
  } catch {
    /* not generated yet */
  }
  const connected = await getSecrets("elevenlabs");
  if (!connected?.apiKey) return null; // decoration only — skip quietly
  try {
    const buffer = await generateSfx(def.prompt, def.durationSeconds);
    await fs.mkdir(SFX_DIR, { recursive: true });
    await fs.writeFile(file, buffer);
    return file;
  } catch (err) {
    console.error(`[sfx] could not generate "${id}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

export interface SfxEvent {
  path: string;
  atMs: number; // output-timeline position
}

/**
 * Sound-effect events for a clip: each timeline entry whose effect has a
 * matching library sound gets it at the entry's OUTPUT start time (beat clamps
 * and speed already baked into the timeline).
 */
export async function buildSfxEvents(entries: TimelineEntry[]): Promise<SfxEvent[]> {
  const events: SfxEvent[] = [];
  for (const seg of entries) {
    const sfxId = seg.effect ? EFFECT_SFX[seg.effect] : undefined;
    if (sfxId && seg.outStartMs > 0) {
      // Skip an SFX at 0ms — an opening whoosh over the hook reads as clumsy.
      const p = await ensureSfx(sfxId);
      if (p) events.push({ path: p, atMs: seg.outStartMs });
    }
  }
  return events;
}
