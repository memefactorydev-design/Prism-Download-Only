"use client";

// Inline "make me a visual" control used by Templates, Director and Studio.
// Fixed-prompt mode fires immediately; ask mode expands a one-line brief
// input first. Results are MediaAssets — the preview confirms, the library
// keeps them.

import { useState } from "react";

export interface GeneratedAsset {
  id: string;
  url: string;
  kind: "image" | "video";
}

export function GenerateVisual({
  kind,
  prompt,
  askPrompt,
  title,
  label,
  aspect,
  className = "",
  onCreated,
}: {
  kind: "image" | "video";
  prompt?: string; // fixed prompt — fires on click
  askPrompt?: string; // placeholder for the expandable brief input
  title?: string;
  label?: string;
  aspect?: "9:16" | "16:9";
  className?: string;
  onCreated?: (asset: GeneratedAsset) => void;
}) {
  const [openInput, setOpenInput] = useState(false);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratedAsset | null>(null);

  const run = async (p: string) => {
    if (!p.trim() || busy) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, prompt: p.trim(), title, aspect }),
      });
      const j = (await res.json()) as { error?: string; asset?: GeneratedAsset };
      if (!res.ok || !j.asset) throw new Error(j.error ?? `HTTP ${res.status}`);
      setPreview(j.asset);
      setOpenInput(false);
      setBrief("");
      onCreated?.(j.asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const defaultLabel = kind === "video" ? "🎬 AI clip" : "✨ AI visual";

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => (prompt ? run(prompt) : setOpenInput((o) => !o))}
          disabled={busy}
          className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-accent disabled:opacity-50"
        >
          {busy ? (kind === "video" ? "Filming… (~2 min)" : "Creating…") : label ?? defaultLabel}
        </button>
        {openInput && !busy && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(brief);
            }}
            className="flex flex-1 items-center gap-1.5"
          >
            <input
              autoFocus
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={askPrompt ?? "Describe the visual…"}
              className="input flex-1 !py-1.5 text-xs"
              maxLength={600}
            />
            <button type="submit" disabled={!brief.trim()} className="btn btn-primary !px-2.5 !py-1.5 text-xs">
              Go
            </button>
          </form>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
      {preview && (
        <div className="mt-2 flex items-center gap-2.5">
          <div className="h-16 w-12 overflow-hidden rounded-md border border-border">
            {preview.kind === "video" ? (
              <video src={preview.url} autoPlay muted loop playsInline className="h-full w-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <p className="text-xs text-muted">Saved to your library ✓</p>
        </div>
      )}
    </div>
  );
}
