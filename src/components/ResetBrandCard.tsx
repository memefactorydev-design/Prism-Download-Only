"use client";

// The /brand danger zone: hard reset. Confirm dialog fetches live counts so
// the member sees exactly what goes and — just as important — what stays.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResetBrandCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<{ upcomingPosts: number; connections: string[] } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openConfirm = async () => {
    setError(null);
    setAgreed(false);
    setOpen(true);
    setCounts(null);
    try {
      const res = await fetch("/api/brand/reset");
      const json = (await res.json()) as { error?: string; upcomingPosts?: number; connections?: string[] };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setCounts({ upcomingPosts: json.upcomingPosts ?? 0, connections: json.connections ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/brand/reset", { method: "POST" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      router.push("/welcome");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 rounded-2xl border border-border p-6">
      <h2 className="text-sm font-semibold text-foreground">Start again from scratch</h2>
      <p className="mt-1 text-sm text-muted">
        Wipes your brand and disconnects your channels, then walks you through setup again — takes about three
        minutes. Your media library, videos, sites and published history stay.
      </p>
      <button
        className="btn mt-4 border border-red-500/40 text-red-500 hover:bg-red-500/10"
        onClick={openConfirm}
      >
        Reset my brand…
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6">
            <h3 className="font-display text-base font-semibold text-foreground">Reset your brand?</h3>
            {!counts && !error && <p className="mt-3 text-sm text-muted">Checking what this touches…</p>}
            {counts && (
              <ul className="mt-3 space-y-1.5 text-sm text-muted">
                <li>• Your brand profile — <span className="text-red-400">erased</span></li>
                <li>
                  • {counts.connections.length
                    ? `${counts.connections.length} connection${counts.connections.length === 1 ? "" : "s"} (${counts.connections.join(", ")}) — `
                    : "Connected services — "}
                  <span className="text-red-400">disconnected</span>
                </li>
                <li>
                  • {counts.upcomingPosts} upcoming unpublished post{counts.upcomingPosts === 1 ? "" : "s"} —{" "}
                  <span className="text-red-400">removed</span>
                </li>
                <li className="pt-1 text-foreground">
                  • Everything else — your photos, videos, sites and published posts — <strong>stays exactly where it is</strong>.
                </li>
              </ul>
            )}
            {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
            <label className="mt-4 flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              I understand — this can&rsquo;t be undone.
            </label>
            <div className="mt-4 flex items-center gap-2">
              <button
                className="btn border border-red-500/40 text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                onClick={reset}
                disabled={!agreed || !counts || busy}
              >
                {busy ? "Resetting…" : "Reset and start again"}
              </button>
              <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
                Keep everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
