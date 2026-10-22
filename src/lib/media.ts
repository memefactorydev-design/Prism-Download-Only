// Upload handling: validate type/size, store via the storage driver, track in DB.
// Per-channel rules (e.g. TikTok needs video) live in lib/posts.ts and are checked
// when a post is submitted; this module enforces the general upload limits.

import type { MediaAsset } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { track } from "@/lib/events";

export const IMAGE_MIMES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
export const VIDEO_MIMES: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

// Generous global caps; per-channel caps are tighter and checked at submit time.
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

export function isVideo(mimeType: string): boolean {
  return mimeType in VIDEO_MIMES;
}

export async function saveUpload(file: File, scopeUserId = ""): Promise<MediaAsset> {
  track("media_uploaded", scopeUserId, { type: file.type, size: file.size });
  const ext = IMAGE_MIMES[file.type] ?? VIDEO_MIMES[file.type];
  if (!ext) {
    throw new Error(
      `Unsupported file type "${file.type || "unknown"}". Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM.`
    );
  }
  const max = isVideo(file.type) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > max) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — over the ${max / 1024 / 1024} MB limit for ${isVideo(file.type) ? "videos" : "images"}.`
    );
  }
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`);

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await getStorage().save(buffer, ext);
  return db.mediaAsset.create({
    data: {
      userId: scopeUserId,
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      storageDriver: stored.storageDriver,
      storagePath: stored.storagePath,
    },
  });
}

/**
 * Assert every asset id exists AND belongs to the given scope (or the caller is
 * an admin working across scopes, signalled by role "admin"). Used wherever a
 * user attaches media to a post/job/project — members can't reach into other
 * sandboxes by guessing ids.
 */
export async function assertAssetsInScope(
  ids: string[],
  user: { id: string; role: string }
): Promise<void> {
  if (ids.length === 0 || user.role === "admin") return;
  const owned = await db.mediaAsset.count({ where: { id: { in: ids }, userId: user.id } });
  if (owned !== new Set(ids).size) {
    throw new Error("One or more selected media files weren't found in your library.");
  }
}

export async function readMediaFile(id: string): Promise<{ asset: MediaAsset; buffer: Buffer } | null> {
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset) return null;
  const buffer = await getStorage().read({
    storageDriver: asset.storageDriver as "local" | "s3",
    storagePath: asset.storagePath,
  });
  return { asset, buffer };
}

export async function removeMedia(id: string): Promise<void> {
  const asset = await db.mediaAsset.findUnique({
    where: { id },
    include: { posts: { where: { status: { in: ["pending_approval", "approved", "scheduled"] } } } },
  });
  if (!asset) return;
  if (asset.posts.length > 0) {
    throw new Error(
      `This file is attached to ${asset.posts.length} post(s) awaiting approval or scheduling. Remove it from those posts first.`
    );
  }
  await getStorage().delete({
    storageDriver: asset.storageDriver as "local" | "s3",
    storagePath: asset.storagePath,
  });
  await db.mediaAsset.delete({ where: { id } });
}
