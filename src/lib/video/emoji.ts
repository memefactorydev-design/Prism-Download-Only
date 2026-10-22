// Emoji "pops": TikTok-style emoji punctuation rendered as Twemoji PNG overlays
// that pop in above the caption line when their word is spoken. PNG overlays —
// not font glyphs — because libass cannot render colour-emoji fonts (they'd come
// out as monochrome tofu); PNGs are deterministic and sharper at 1080p anyway.
// Twemoji art is CC-BY 4.0; PNGs are fetched once and cached under
// data/emoji-cache so renders stay offline after the first use of an emoji.

import { promises as fs } from "node:fs";
import path from "node:path";
import { toOutMs, type TimelineEntry } from "@/lib/video/timeline";
import type { TranscriptWord } from "@/lib/video/transcribe";

const CACHE_DIR = path.join(process.cwd(), "data", "emoji-cache");
const CDN = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72";
const POP_MS = 900; // how long each emoji stays up
const MAX_POPS = 4; // decoration, not confetti

export interface EmojiHint {
  word: string;
  emoji: string;
}

export interface EmojiOverlay {
  pngPath: string;
  startMs: number;
  endMs: number;
}

// Twemoji filenames: hyphen-joined hex codepoints; the VS16 selector (fe0f) is
// dropped for non-ZWJ sequences (twemoji's naming convention, simplified).
function codepoints(emoji: string): string {
  const cps = Array.from(emoji.trim()).map((c) => c.codePointAt(0)!.toString(16));
  const hasZwj = cps.includes("200d");
  return (hasZwj ? cps : cps.filter((c) => c !== "fe0f")).join("-");
}

async function fetchPng(emoji: string): Promise<string | null> {
  const name = codepoints(emoji);
  if (!name) return null;
  const file = path.join(CACHE_DIR, `${name}.png`);
  try {
    await fs.access(file);
    return file;
  } catch {
    /* not cached yet */
  }
  try {
    const res = await fetch(`${CDN}/${name}.png`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch {
    return null;
  }
}

/**
 * Map emoji hints onto the OUTPUT timeline: each hint pops when its word is
 * first spoken within the clip. Un-matched words and un-fetchable emojis are
 * skipped silently — an emoji is decoration, never a render blocker.
 */
export async function buildEmojiOverlays(
  entries: TimelineEntry[],
  wordsFor: (e: TimelineEntry) => TranscriptWord[],
  hints: EmojiHint[] | undefined
): Promise<EmojiOverlay[]> {
  if (!hints?.length) return [];
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const timed: { emoji: string; startMs: number }[] = [];
  const remaining = hints.filter((h) => h.word && h.emoji).slice(0, MAX_POPS * 2);
  for (const seg of entries) {
    for (const w of wordsFor(seg)) {
      if (w.endMs <= seg.srcStartMs || w.startMs >= seg.srcEndMs) continue;
      const idx = remaining.findIndex((h) => norm(h.word) === norm(w.text));
      if (idx >= 0) {
        const [hint] = remaining.splice(idx, 1);
        timed.push({ emoji: hint.emoji, startMs: toOutMs(seg, w.startMs) });
      }
    }
  }
  const overlays: EmojiOverlay[] = [];
  for (const t of timed.slice(0, MAX_POPS)) {
    const pngPath = await fetchPng(t.emoji);
    if (pngPath) overlays.push({ pngPath, startMs: t.startMs, endMs: t.startMs + POP_MS });
  }
  return overlays;
}
