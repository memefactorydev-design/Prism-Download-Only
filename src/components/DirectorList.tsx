"use client";

// Director home: project grid + the 3-step "New project" starter (step 1: pick
// footage and/or photos). Keep it Apple-simple — pick sources, name it, go.

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { IconSparkles } from "@/components/ui/icons";

export interface ProjectListItem {
  id: string;
  title: string;
  status: string;
  sourceCount: number;
  latestRevision: string | null;
  updatedAt: string;
}

export interface VideoAssetOption {
  id: string;
  name: string;
  durationSecs: number | null;
  isPhoto?: boolean;
}

export function DirectorList({
  projects,
  videoAssets,
}: {
  projects: ProjectListItem[];
  videoAssets: VideoAssetOption[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 8 ? prev : [...prev, id]
    );
  }

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/fable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || undefined, assetIds: selected }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy(false);
    if (res.ok && body.id) router.push(`/director/${body.id}`);
    else setError(body.error ?? "Could not create the project.");
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          1. Pick footage &nbsp;·&nbsp; 2. Describe it &nbsp;·&nbsp; 3. Watch it build
        </p>
        <button onClick={() => setCreating((c) => !c)} className="btn btn-primary">
          <IconSparkles className="h-4 w-4" />
          New project
        </button>
      </div>

      {creating && (
        <div className="card mb-6 p-5">
          <h2 className="text-sm font-semibold text-foreground">Step 1 — pick your footage</h2>
          <p className="mt-1 text-xs text-muted">
            Choose up to 8 videos or photos from your library (upload on the Media page first). Photos are brought to life as cinematic footage when the cut renders.
          </p>
          {videoAssets.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Nothing in the library yet — upload footage or photos on the{" "}
              <Link href="/media" className="text-accent underline">Media page</Link>.
            </p>
          ) : (
            <div className="mt-3 grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {videoAssets.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => toggle(v.id)}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
                    selected.includes(v.id)
                      ? "border-[var(--accent)] bg-accent-soft text-foreground"
                      : "border-border text-muted hover:border-border-strong"
                  }`}
                >
                  <span className="truncate">{v.name}</span>
                  <span className="shrink-0 text-faint">{v.isPhoto ? "photo" : v.durationSecs ? `${Math.round(v.durationSecs)}s` : ""}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project name (optional)"
              className="input w-64"
            />
            <button onClick={create} disabled={busy || selected.length === 0} className="btn btn-primary">
              {busy ? "Setting up…" : `Start with ${selected.length || "…"} source${selected.length === 1 ? "" : "s"}`}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      )}

      {projects.length === 0 && !creating ? (
        <p className="mt-6 text-sm text-muted">
          No projects yet — hit <span className="font-medium text-foreground">New project</span>, pick footage, and
          tell the Director what to make.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/director/${p.id}`} className="card block p-5 transition hover:shadow-glow">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{p.title}</h2>
                <span
                  className={`badge ${
                    p.status === "ready"
                      ? "bg-accent-soft text-accent"
                      : p.status === "failed"
                        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : "bg-foreground/8 text-muted"
                  }`}
                >
                  {p.status}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted">
                {p.sourceCount} source{p.sourceCount === 1 ? "" : "s"}
                {p.latestRevision ? ` · ${p.latestRevision}` : " · no renders yet"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
