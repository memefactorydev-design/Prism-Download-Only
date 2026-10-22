"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { IconMusic, IconX } from "@/components/ui/icons";

export type MusicChoice =
  | { kind: "upload"; file: File }
  | { kind: "library"; assetId: string; name: string }
  | null;

const MOODS = [
  "cinematic",
  "epic",
  "upbeat",
  "chill",
  "corporate",
  "hip hop",
  "electronic",
  "acoustic",
];

export function MusicPicker({
  value,
  onChange,
}: {
  value: MusicChoice;
  onChange: (v: MusicChoice) => void;
}) {
  const [mode, setMode] = useState<"upload" | "compose">("compose");
  const [composePrompt, setComposePrompt] = useState("");
  const [composeSecs, setComposeSecs] = useState(30);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compose() {
    if (!composePrompt.trim()) return;
    setComposing(true);
    setError(null);
    const res = await fetch("/api/music/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: composePrompt, seconds: composeSecs }),
    });
    const body = (await res.json().catch(() => ({}))) as { assetId?: string; name?: string; error?: string };
    setComposing(false);
    if (!res.ok || !body.assetId) setError(body.error ?? "Composition failed.");
    else onChange({ kind: "library", assetId: body.assetId, name: body.name ?? "Composed track" });
  }

  const chosen =
    value?.kind === "upload"
      ? value.file.name
      : value?.kind === "library"
        ? value.name
        : null;

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <IconMusic className="h-4 w-4 text-accent" /> Music bed (trailer)
        </span>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "compose", label: "✨ Compose" },
            { value: "upload", label: "Upload" },
          ]}
        />
      </div>

      {chosen && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">
            {chosen}
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="Remove music"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}

      {mode === "upload" ? (
        <label className="mt-3 block">
          <span className="btn btn-secondary cursor-pointer py-1.5">
            Choose a music file…
          </span>
          <input
            type="file"
            accept="audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onChange({ kind: "upload", file: f });
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-muted">
            Describe the vibe and Prism Score composes an original, commercially-cleared track — sized to your video.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="input min-w-40 flex-1"
              placeholder="e.g. warm minimal house, premium calm, late-night confidence"
              value={composePrompt}
              onChange={(e) => setComposePrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && compose()}
            />
            <select value={composeSecs} onChange={(e) => setComposeSecs(Number(e.target.value))} className="input w-auto py-1.5">
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={90}>90s</option>
            </select>
            <button onClick={compose} disabled={composing || !composePrompt.trim()} className="btn btn-primary py-1.5">
              {composing ? "Composing… (~1 min)" : "✨ Compose"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MOODS.map((m) => (
              <button key={m} onClick={() => setComposePrompt((p) => (p ? `${p}, ${m}` : m))} className="badge bg-foreground/8 text-muted hover:text-foreground">
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
