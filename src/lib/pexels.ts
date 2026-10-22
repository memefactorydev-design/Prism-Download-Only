// Pexels stock search + import. Free stock photos/videos ("Find stock" in the
// media library) — imported files become normal MediaAssets, so every feature
// (Director sources, Ad Studio grounding, calendar posts) can use them.
// Pexels API ToS: free incl. commercial use; attribution appreciated; don't
// present Pexels content as your own API. Download URLs are pinned to Pexels
// hosts (SSRF guard).

import { getSecrets } from "@/lib/connections";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const ALLOWED_HOSTS = [/(^|\.)pexels\.com$/, /(^|\.)pexels\.video$/];

export interface StockResult {
  id: string;
  type: "photo" | "video";
  thumb: string; // preview image URL
  photographer: string;
  url: string; // Pexels page (attribution link)
  downloadUrl: string; // best-fit file to import
  durationSecs?: number; // videos only
  width: number;
  height: number;
}

async function pexelsKey(): Promise<string> {
  const secrets = await getSecrets("pexels");
  if (!secrets?.apiKey) throw new Error("Pexels isn't connected yet — add your API key on the Connections page.");
  return secrets.apiKey;
}

export async function searchStock(query: string, type: "photo" | "video", perPage = 18): Promise<StockResult[]> {
  const key = await pexelsKey();
  const base = type === "photo" ? "https://api.pexels.com/v1/search" : "https://api.pexels.com/videos/search";
  const res = await fetch(`${base}?query=${encodeURIComponent(query)}&per_page=${perPage}`, {
    headers: { Authorization: key },
  });
  if (!res.ok) throw new Error(`Pexels search failed (HTTP ${res.status}).`);
  const data = (await res.json()) as Record<string, unknown>;

  if (type === "photo") {
    const photos = (data.photos ?? []) as Array<{
      id: number;
      width: number;
      height: number;
      url: string;
      photographer: string;
      src: { large2x?: string; large?: string; medium?: string; original?: string };
    }>;
    return photos.map((p) => ({
      id: String(p.id),
      type: "photo" as const,
      thumb: p.src.medium ?? p.src.large ?? p.src.original ?? "",
      photographer: p.photographer,
      url: p.url,
      downloadUrl: p.src.large2x ?? p.src.original ?? p.src.large ?? "",
      width: p.width,
      height: p.height,
    }));
  }
  const videos = (data.videos ?? []) as Array<{
    id: number;
    width: number;
    height: number;
    url: string;
    duration: number;
    image: string;
    user: { name: string };
    video_files: Array<{ width: number; height: number; link: string; file_type: string }>;
  }>;
  return videos.map((v) => {
    // Best mp4 up to 1080p-ish — big enough for a 9:16 crop, small enough to import.
    const mp4s = v.video_files
      .filter((f) => f.file_type === "video/mp4" && f.link)
      .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    const best = mp4s.find((f) => (f.width ?? 0) <= 1920) ?? mp4s[mp4s.length - 1];
    return {
      id: String(v.id),
      type: "video" as const,
      thumb: v.image,
      photographer: v.user?.name ?? "Pexels creator",
      url: v.url,
      downloadUrl: best?.link ?? "",
      durationSecs: v.duration,
      width: v.width,
      height: v.height,
    };
  });
}

/** Download one stock item into the media library. Returns the MediaAsset id. */
export async function importStock(downloadUrl: string, type: "photo" | "video", credit: string, scopeUserId = ""): Promise<string> {
  await pexelsKey(); // connection required even for the download step
  const host = new URL(downloadUrl).hostname;
  if (!ALLOWED_HOSTS.some((re) => re.test(host))) {
    throw new Error("Refusing to download from outside Pexels.");
  }
  const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Stock download failed (HTTP ${res.status}).`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_IMPORT_BYTES) throw new Error("That stock file is over the 200 MB import cap.");
  const mime = res.headers.get("content-type")?.split(";")[0] || (type === "photo" ? "image/jpeg" : "video/mp4");
  const ext = mime.includes("png") ? ".png" : mime.includes("jpeg") || mime.includes("jpg") ? ".jpg" : ".mp4";
  const stored = await getStorage().save(buffer, ext);
  const asset = await db.mediaAsset.create({
    data: {
      userId: scopeUserId,
      originalName: `pexels-${credit.replace(/[^\w-]+/g, "_").slice(0, 40)}${ext}`,
      mimeType: mime,
      sizeBytes: buffer.length,
      storageDriver: stored.storageDriver,
      storagePath: stored.storagePath,
    },
  });
  return asset.id;
}
