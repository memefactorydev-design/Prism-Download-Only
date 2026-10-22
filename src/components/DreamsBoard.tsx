"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NamedAgent } from "@/lib/named-agents";
import type { DreamRecord } from "@/lib/memory";
import { Reveal } from "@/components/ui/Reveal";

interface DreamResult {
  agentId: string;
  skipped?: boolean;
  reason?: string;
  record?: { report: string; ideas: string[]; entryCount: number };
  error?: string;
}

export function DreamsBoard({ dreams, agents }: { dreams: DreamRecord[]; agents: NamedAgent[] }) {
  const router = useRouter();
  const [target, setTarget] = useState("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const byId = new Map(agents.map((a) => [a.id, a]));
  const sorted = [...dreams].sort((a, b) => (a.ts < b.ts ? 1 : -1));

  async function dreamNow() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/dream/${target}`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { results?: DreamResult[]; error?: string };
      if (!res.ok || data.error || !data.results) {
        setNotice({ tone: "err", text: data.error ?? `Dream cycle failed (HTTP ${res.status}).` });
      } else {
        const dreamed = data.results.filter((r) => r.record).length;
        const skipped = data.results.filter((r) => r.skipped).length;
        const errors = data.results.filter((r) => r.error);
        const parts = [
          `${dreamed} dream${dreamed === 1 ? "" : "s"} complete`,
          `${skipped} skipped (nothing new to dream about)`,
        ];
        if (errors.length) {
          parts.push(
            `errors — ${errors
              .map((r) => `${byId.get(r.agentId)?.name ?? r.agentId}: ${r.error}`)
              .join(" · ")}`
          );
        }
        setNotice({ tone: errors.length ? "err" : "ok", text: parts.join(" · ") });
      }
    } catch (err) {
      setNotice({ tone: "err", text: err instanceof Error ? err.message : "Dream cycle failed." });
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <Reveal>
        <div className="card p-5">
          <h2 className="font-display text-base font-semibold text-foreground">☾ The dream cycle</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Every night at 3am while you sleep, each agent replays its day — every chat, thumbs-up and
            thumbs-down, saved note and market brief — then rewrites its own memory and learnings
            and wakes with fresh ideas. You can also trigger a cycle by hand.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="input w-56"
              aria-label="Who should dream"
            >
              <option value="all">The whole team</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.emoji} {a.name} — {a.title}
                </option>
              ))}
            </select>
            <button onClick={dreamNow} disabled={busy} className="btn btn-primary">
              {busy ? "☾ Dreaming…" : "☾ Dream now"}
            </button>
          </div>
          {notice && (
            <p className={`mt-3 text-sm ${notice.tone === "err" ? "text-danger" : "text-accent"}`}>
              {notice.text}
            </p>
          )}
        </div>
      </Reveal>

      {sorted.length === 0 ? (
        <p className="mt-8 text-sm text-faint">
          No dreams yet. Dreams need raw material — chat to the agents, rate their replies and save notes to
          memory first, then run a cycle (or let the 3am dream do it) and their reflections will appear here.
        </p>
      ) : (
        <div className="mt-6 space-y-5">
          {sorted.map((d, i) => {
            const agent = byId.get(d.agentId);
            return (
              <Reveal key={d.id} i={i}>
                <div className="card p-5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-xl">{agent?.emoji ?? "☾"}</span>
                    <h3 className="font-display text-base font-semibold" style={{ color: agent?.color }}>
                      {d.agentName}
                    </h3>
                    <span className="text-xs text-faint">
                      {new Date(d.ts).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span className="text-xs text-muted">
                      replayed {d.entryCount} journal {d.entryCount === 1 ? "entry" : "entries"}
                    </span>
                  </div>

                  {d.ideas.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {d.ideas.map((idea, j) => (
                        <span key={j} className="badge border border-border bg-accent-soft text-foreground">
                          💡 {idea}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 whitespace-pre-wrap rounded-xl border border-border bg-surface/50 p-4 text-sm leading-relaxed text-muted">
                    {d.report || "(empty dream report)"}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      )}
    </div>
  );
}
