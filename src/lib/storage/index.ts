// Media storage behind one interface: local disk for dev, S3-compatible for prod.
// Selected by STORAGE_DRIVER. Upload validation (type/size) happens in lib/media.ts
// before anything reaches a driver.

import { createWriteStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Thrown by saveStream when the incoming body exceeds the byte cap — lets callers
// return a clean 413 instead of filling the disk.
export class UploadTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Upload exceeds the ${Math.round(limitBytes / 1024 / 1024 / 1024)} GB limit.`);
    this.name = "UploadTooLargeError";
  }
}

export interface StoredFile {
  storageDriver: "local" | "s3";
  storagePath: string;
}

export interface StorageDriver {
  save(buffer: Buffer, extension: string): Promise<StoredFile>;
  // Stream a large file straight to storage without buffering it in memory —
  // used by the Studio raw-video upload, where files can be multiple GB. When
  // maxBytes is set, aborts + cleans up the partial and throws UploadTooLargeError
  // as soon as the cap is exceeded (so an oversized upload can't fill the disk).
  saveStream(stream: Readable, extension: string, maxBytes?: number): Promise<StoredFile>;
  read(file: StoredFile): Promise<Buffer>;
  delete(file: StoredFile): Promise<void>;
}

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

const localDriver: StorageDriver = {
  async save(buffer, extension) {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const storagePath = `${randomUUID()}${extension}`;
    await fs.writeFile(path.join(UPLOADS_DIR, storagePath), buffer);
    return { storageDriver: "local", storagePath };
  },
  async saveStream(stream, extension, maxBytes) {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const storagePath = `${randomUUID()}${extension}`;
    const full = path.join(UPLOADS_DIR, storagePath);
    try {
      if (maxBytes && maxBytes > 0) {
        let written = 0;
        const limiter = new Transform({
          transform(chunk, _enc, cb) {
            written += chunk.length;
            if (written > maxBytes) cb(new UploadTooLargeError(maxBytes));
            else cb(null, chunk);
          },
        });
        await pipeline(stream, limiter, createWriteStream(full));
      } else {
        await pipeline(stream, createWriteStream(full));
      }
      return { storageDriver: "local", storagePath };
    } catch (err) {
      await fs.unlink(full).catch(() => {}); // never leave a partial behind
      throw err;
    }
  },
  async read(file) {
    // storagePath is always a generated UUID filename, but join defensively.
    const full = path.join(UPLOADS_DIR, path.basename(file.storagePath));
    return fs.readFile(full);
  },
  async delete(file) {
    await fs.unlink(path.join(UPLOADS_DIR, path.basename(file.storagePath))).catch(() => {});
  },
};

export function getStorage(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  switch (driver) {
    case "local":
      return localDriver;
    case "s3":
      throw new Error(
        "The S3 driver isn't implemented yet — use STORAGE_DRIVER=local. S3 lands when the app is deployed."
      );
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${driver}" — use "local" or "s3".`);
  }
}

// ffmpeg/whisper need a real file path, not a Buffer. For the local driver that's
// the upload on disk; for S3 (later) the caller must download to a temp file first.
export function localFilePath(file: StoredFile): string {
  if (file.storageDriver !== "local") {
    throw new Error("A local file path is only available for the local storage driver.");
  }
  return path.join(UPLOADS_DIR, path.basename(file.storagePath));
}
