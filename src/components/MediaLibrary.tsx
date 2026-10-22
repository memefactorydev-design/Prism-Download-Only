"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export interface MediaItem {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function MediaThumb({
  item,
  className,
}: {
  item: MediaItem;
  className?: string;
}) {
  const src = `/api/media/${item.id}/file`;
  if (item.mimeType.startsWith("video/")) {
    return (
      <video
        src={src}
        className={className}
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- local authenticated stream, not optimizable
  return <img src={src} alt={item.originalName} className={className} />;
}

export function MediaLibrary({ media }: { media: MediaItem[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Lightbox: click any tile to view it full size (videos play with sound);
  // ←/→ flips through the library, Esc closes.
  const [viewing, setViewing] = useState<number | null>(null);
  const step = useCallback(
    (d: number) =>
      setViewing((v) => (v === null ? v : Math.min(Math.max(v + d, 0), media.length - 1))),
    [media.length]
  );
  useEffect(() => {
    if (viewing === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewing(null);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, step]);

  async function upload(files: FileList | File[]) {
    if (!files.length) return;
    setBusy(true);
    setErrors([]);
    const form = new FormData();
    for (const f of files) form.append("file", f);
    const res = await fetch("/api/media", { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as {
      errors?: string[];
      error?: string;
    };
    setBusy(false);
    const errs = body.errors?.length
      ? body.errors
      : body.error
        ? [body.error]
        : [];
    setErrors(errs);
    router.refresh();
  }

  async function remove(item: MediaItem) {
    if (!confirm(`Delete "${item.originalName}"?`)) return;
    const res = await fetch(`/api/media/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setErrors([body.error ?? "Delete failed."]);
    }
    router.refresh();
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(Array.from(e.dataTransfer.files));
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging
            ? "border-accent bg-accent-soft"
            : "border-border-strong hover:border-border-strong"
        }`}
      >
        <p className="text-sm font-medium">
          {busy ? "Uploading…" : "Drag & drop images or videos"}
        </p>
        <p className="mt-1 text-xs text-muted">
          or click to browse — JPEG, PNG, WebP, GIF, MP4, MOV, WebM
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {errors.map((e, i) => (
        <p key={i} className="mt-3 text-sm text-red-500">
          {e}
        </p>
      ))}

      <StockSearch onImported={() => router.refresh()} />

      {media.length === 0 ? (
        <p className="mt-8 text-sm text-muted">
          No media yet — upload your first clips and shots above.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((item, idx) => (
            <div
              key={item.id}
              className="group overflow-hidden rounded-xl border border-border"
            >
              <button
                type="button"
                onClick={() => setViewing(idx)}
                className="relative flex h-36 w-full cursor-zoom-in items-center justify-center overflow-hidden bg-foreground/8"
                aria-label={`Preview ${item.originalName}`}
              >
                <MediaThumb
                  item={item}
                  className="h-full w-full object-cover"
                />
                {item.mimeType.startsWith("video/") && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5Z" /></svg>
                    </span>
                  </span>
                )}
              </button>
              <div className="flex items-center justify-between gap-2 p-2.5">
                <div className="min-w-0">
                  <p
                    className="truncate text-xs font-medium"
                    title={item.originalName}
                  >
                    {item.originalName}
                  </p>
                  <p className="text-[11px] text-muted">
                    {item.mimeType.startsWith("video/") ? "Video" : "Image"} ·{" "}
                    {formatBytes(item.sizeBytes)}
                  </p>
                </div>
                <button
                  onClick={() => remove(item)}
                  className="shrink-0 text-xs text-red-500 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing !== null && media[viewing] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setViewing(null)}
        >
          <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 pb-2.5 text-white">
              <p className="min-w-0 truncate text-sm font-medium">{media[viewing].originalName}</p>
              <div className="flex shrink-0 items-center gap-2 text-xs text-white/70">
                <span>
                  {media[viewing].mimeType.startsWith("video/") ? "Video" : "Image"} · {formatBytes(media[viewing].sizeBytes)} · {viewing + 1} of {media.length}
                </span>
                <button onClick={() => setViewing(null)} aria-label="Close" className="ml-1 rounded-full bg-white/10 px-2.5 py-1 text-white hover:bg-white/20">
                  ✕
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {media[viewing].mimeType.startsWith("video/") ? (
                <video
                  key={media[viewing].id}
                  src={`/api/media/${media[viewing].id}/file`}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[80vh] w-auto max-w-full rounded-xl"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={media[viewing].id}
                  src={`/api/media/${media[viewing].id}/file`}
                  alt={media[viewing].originalName}
                  className="max-h-[80vh] w-auto max-w-full rounded-xl object-contain"
                />
              )}
            </div>
            {viewing > 0 && (
              <button
                onClick={() => step(-1)}
                aria-label="Previous"
                className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 sm:-left-14"
              >
                ←
              </button>
            )}
            {viewing < media.length - 1 && (
              <button
                onClick={() => step(1)}
                aria-label="Next"
                className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 sm:-right-14"
              >
                →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// "Find stock" — Pexels search + one-click import into the library. Imported
// files are normal MediaAssets, so Director/Ad Studio/Calendar can all use them.
function StockSearch({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"photo" | "video">("video");
  const [results, setResults] = useState<
    {
      id: string;
      type: string;
      thumb: string;
      photographer: string;
      url: string;
      downloadUrl: string;
      durationSecs?: number;
    }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/media/stock?q=${encodeURIComponent(query)}&type=${type}`,
    );
    const body = (await res.json().catch(() => ({}))) as {
      results?: typeof results;
      error?: string;
    };
    setBusy(false);
    if (res.ok && body.results) setResults(body.results);
    else setError(body.error ?? "Stock search failed.");
  }

  async function importOne(r: (typeof results)[number]) {
    setImporting(r.id);
    setError(null);
    const res = await fetch("/api/media/stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        downloadUrl: r.downloadUrl,
        type: r.type,
        credit: r.photographer,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setImporting(null);
    if (!res.ok) setError(body.error ?? "Import failed.");
    else onImported();
  }

  return (
    <div className="mt-4 rounded-2xl border border-border p-4 ">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-medium"
      >
        🔎 Find stock {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="e.g. workshop b-roll, product close-up"
              className="w-72 rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm "
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "photo" | "video")}
              className="rounded-lg border border-border-strong bg-transparent px-2 py-2 text-sm  "
            >
              <option value="video">Video b-roll</option>
              <option value="photo">Photos</option>
            </select>
            <button
              onClick={search}
              disabled={busy || !query.trim()}
              className="rounded-lg bg-gradient-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Searching…" : "Search"}
            </button>
            <span className="text-xs text-muted">
              Free for commercial use — crediting the creator is appreciated.
            </span>
          </div>
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          {results.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {results.map((r) => (
                <div
                  key={r.id}
                  className="group relative overflow-hidden rounded-lg border border-border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.thumb}
                    alt={r.photographer}
                    className="aspect-square w-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-1 text-[10px] text-white">
                    {r.durationSecs ? `${r.durationSecs}s · ` : ""}
                    {r.photographer}
                  </div>
                  <button
                    onClick={() => importOne(r)}
                    disabled={importing !== null}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100"
                  >
                    {importing === r.id ? "Importing…" : "＋ Import"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
