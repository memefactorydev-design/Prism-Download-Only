// Music for Studio and Director: Eleven Music composes an original,
// commercially-cleared track from a vibe prompt, sized to the video, stored as
// a plain MediaAsset. Uploads are the only other music source — no third-party
// libraries.

import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getSecrets } from "@/lib/connections";
import { generateMusic } from "@/lib/elevenlabs";

const MAX_MUSIC_BYTES = 80 * 1024 * 1024;

/** The one music engine. Null = not connected (callers fail loudly). */
export async function musicEngine(): Promise<"elevenlabs" | null> {
  if (await getSecrets("elevenlabs")) return "elevenlabs";
  return null;
}

/** Compose a track with Eleven Music and store it as a MediaAsset. */
export async function composeMusicAsset(prompt: string, lengthMs: number, scopeUserId = ""): Promise<{ assetId: string; name: string }> {
  const full = `${prompt}. Instrumental only, no vocals — a background bed for a short-form vertical video.`;
  const audio = await generateMusic(full, lengthMs);
  if (audio.length > MAX_MUSIC_BYTES) throw new Error("Composed track is unexpectedly large.");
  const stored = await getStorage().saveStream(Readable.from(audio), ".mp3", MAX_MUSIC_BYTES);
  const name = `Prism Score · ${prompt.slice(0, 80)}`;
  const asset = await db.mediaAsset.create({
    data: {
      userId: scopeUserId,
      originalName: `${name}.mp3`,
      mimeType: "audio/mpeg",
      sizeBytes: audio.length,
      storageDriver: stored.storageDriver,
      storagePath: stored.storagePath,
    },
  });
  return { assetId: asset.id, name };
}
