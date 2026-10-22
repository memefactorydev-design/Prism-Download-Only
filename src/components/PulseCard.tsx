"use client";

// The weekly Pulse on /reports: what worked (your data), what's rising
// (live trends), three one-tap actions — every tap ends in an approval.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PulseData } from "@/lib/pulse";

export function PulseCard({ initial }: { initial: { id: string; createdAt: string; data: PulseData } | null }) {
  const router = useRouter();
  const [pulse, setPulse] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const generate = async () => {
    setBusy("gen");
    setError(null);
    const res = await fetch("/api/pulse", { method: "POST" });
    const b = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy(null);
    if (!res.ok || !b.id) {
      setError(b.error ?? "Pulse failed — try again.");
      return;
    }
    router.refresh();
  };

  const act = async (index: number) => {
    if (!pulse) return;
    setBusy(String(index));
    setError(null);
    setNotice(null);
    const res = await fetch("/api/pulse/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: pulse.id, index }),
    });
    const b = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    setBusy(null);
    if (!res.ok) {
      setError(b.error ?? "That action failed.");
      return;
    }
    setNotice(b.message ?? "Done.");
    setPulse((p) =>
      p ? { ...p, data: { ...p.data, actions: p.data.actions.map((a, i) => (i === index ? { ...a, done: true } : a)) } } : p
    );
  };

  return (
    <div className="card mb-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">⚡ Prism Pulse</h2>
          <p className="mt-0.5 text-xs text-faint">
            {pulse ? `This week's read · ${new Date(pulse.createdAt).toLocaleDateString("en-GB")}` : "Your week, read honestly: what worked, what's rising, what to do next."}
          </p>
        </div>
        <button onClick={generate} disabled={busy === "gen"} className="btn btn-secondary text-xs">
          {busy === "gen" ? "Reading your week… (a minute)" : pulse ? "Refresh Pulse" : "⚡ Generate Pulse"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {notice && <p className="mt-3 text-sm text-success">{notice}</p>}

      {pulse && (
        <div className="mt-4 grid gap-5 lg:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">What worked — your data</p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted">
              {pulse.data.worked.map((w, i) => (
                <li key={i} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />{w}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">What&rsquo;s rising — live from your market</p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted">
              {pulse.data.rising.map((r, i) => (
                <li key={i} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Do next</p>
            <div className="mt-2 space-y-2">
              {pulse.data.actions.map((a, i) => (
                <div key={i} className="rounded-lg border border-border p-2.5">
                  <p className="text-sm font-medium leading-snug">{a.title}</p>
                  <p className="mt-0.5 text-xs text-faint">{a.why}</p>
                  <button
                    onClick={() => act(i)}
                    disabled={busy !== null || a.done}
                    className="btn btn-primary mt-2 !py-1 text-xs disabled:opacity-50"
                  >
                    {a.done ? "Done ✓" : busy === String(i) ? "Doing it…" : "Do it"}
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-faint">Every action ends in a draft or approval — nothing publishes or spends by itself.</p>
          </div>
        </div>
      )}
    </div>
  );
}
