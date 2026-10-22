"use client";

// Admin ticket queue: open first, expandable transcript, resolve with a note.

import { useCallback, useEffect, useState } from "react";

interface Ticket {
  id: string;
  reference: string;
  member: string;
  subject: string;
  summary: string;
  urgency: string;
  status: string;
  resolution: string | null;
  transcript: string;
  createdAt: string;
}

const URGENCY_TONE: Record<string, string> = {
  high: "text-red-400 border-red-500/40",
  normal: "text-amber-400 border-amber-500/40",
  low: "text-faint border-border",
};

export function TicketsBoard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/tickets")
      .then((r) => r.json())
      .then((j: { tickets?: Ticket[]; error?: string }) => {
        if (j.error) setError(j.error);
        else setTickets(j.tickets ?? []);
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(load, [load]);

  const resolve = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", note }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setNote("");
      setOpenId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!tickets.length)
    return (
      <div className="rounded-2xl border border-border p-6 text-sm text-muted">
        No tickets — Iris is handling everything in chat.
      </div>
    );

  return (
    <div className="space-y-3">
      {tickets.map((t) => {
        const transcript: { role: string; content: string }[] = (() => {
          try {
            return JSON.parse(t.transcript) as { role: string; content: string }[];
          } catch {
            return [];
          }
        })();
        const expanded = openId === t.id;
        return (
          <div key={t.id} className={`rounded-2xl border p-4 ${t.status === "open" ? "border-border" : "border-border/50 opacity-70"}`}>
            <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpenId(expanded ? null : t.id)}>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t.reference} · {t.subject}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {t.member} · {new Date(t.createdAt).toLocaleString("en-GB")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${URGENCY_TONE[t.urgency] ?? URGENCY_TONE.low}`}>{t.urgency}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${t.status === "open" ? "border-amber-500/40 text-amber-400" : "border-emerald-500/40 text-emerald-400"}`}>
                  {t.status}
                </span>
              </div>
            </button>
            {expanded && (
              <div className="mt-3 space-y-3 border-t border-border pt-3">
                <p className="text-sm text-muted">{t.summary}</p>
                {t.resolution && <p className="text-sm text-emerald-400">Resolved: {t.resolution}</p>}
                {transcript.length > 0 && (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer text-faint">Chat transcript at raise time ({transcript.length} messages)</summary>
                    <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-surface/40 p-3">
                      {transcript.map((m, i) => (
                        <p key={i}>
                          <span className="font-semibold text-foreground">{m.role === "user" ? "Member" : "Iris"}:</span> {m.content}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
                {t.status === "open" && (
                  <div className="flex gap-2">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Resolution note (the member sees this in Iris)"
                      className="input flex-1"
                      maxLength={1000}
                    />
                    <button className="btn btn-primary" onClick={() => resolve(t.id)} disabled={busy === t.id}>
                      {busy === t.id ? "Resolving…" : "Resolve"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
