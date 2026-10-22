"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { IconSparkles, IconArrowRight } from "@/components/ui/icons";

export interface SiteRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  publishedUrl: string | null;
  pageCount: number;
  updatedAt: string;
}

export function SitesList({ sites }: { sites: SiteRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("landing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) {
      setError("Name your site first.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy(false);
    if (res.ok && body.id) router.push(`/sites/${body.id}`);
    else setError(body.error ?? "Could not create the site.");
  }

  return (
    <div>
      <div className="card p-5">
        <h2 className="font-display text-base font-semibold text-foreground">Start a new build</h2>
        <p className="mt-1 text-sm text-muted">Name it, pick a type, then describe it in chat — your AI designer builds it live.</p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-xs text-muted">Name</span>
            <input className="input" placeholder="e.g. Match-day highlights landing page" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">Type</span>
            <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="landing">Landing page</option>
              <option value="site">Website</option>
            </select>
          </label>
          <button onClick={create} disabled={busy} className="btn btn-primary">
            <IconSparkles className="h-4 w-4" />
            {busy ? "Creating…" : "Create & design"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>

      {sites.length === 0 ? (
        <p className="mt-8 text-sm text-faint">No sites yet — create your first above and start chatting to build it.</p>
      ) : (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {sites.map((s, i) => (
            <Reveal key={s.id} i={i}>
              <Link href={`/sites/${s.id}`} className="card card-hover group flex items-center justify-between p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{s.name}</span>
                    <span className={`badge ${s.status === "published" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-foreground/8 text-muted"}`}>
                      {s.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {s.kind === "landing" ? "Landing page" : "Website"} · {s.pageCount} page{s.pageCount === 1 ? "" : "s"}
                    {s.publishedUrl ? ` · ${s.publishedUrl}` : ""}
                  </div>
                </div>
                <IconArrowRight className="h-4 w-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
