"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { IconSparkles } from "@/components/ui/icons";
import { WorkingState } from "@/components/ui/Loading";
import { EmptyState } from "@/components/ui/EmptyState";

interface Fix {
  area: string;
  what: string;
  where: string;
  targetUrl?: string;
  fixKind?: string;
  currentValue: string;
  exactChange: string;
  jsonLd: string;
  impact: string;
  effort: string;
}
export interface SeoData {
  reportMarkdown: string;
  scoreSnapshot: string;
  fixes: Fix[];
  keywords: { keyword: string; intent: string; opportunity: string }[];
  contentIdeas: { title: string; targetKeyword: string; type: string; intent: string }[];
  gbpActions: string[];
  geoNotes: string;
  caveats: string[];
}
export interface SeoReport {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  data: SeoData | null;
}

const impactTone: Record<string, string> = {
  high: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  med: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  low: "bg-foreground/8 text-muted",
};

export function SeoHub({ reports }: { reports: SeoReport[] }) {
  const router = useRouter();
  const [focus, setFocus] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = reports.find((r) => r.data) ?? null;
  const [applyBusy, setApplyBusy] = useState<number | null>(null);
  const [applyResult, setApplyResult] = useState<Record<number, { applied: boolean; message: string }>>({});
  const [gbpBusy, setGbpBusy] = useState<number | null>(null);
  const [gbpDone, setGbpDone] = useState<Record<number, boolean>>({});

  async function applyFix(i: number) {
    if (!latest) return;
    setApplyBusy(i);
    const res = await fetch("/api/seo/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: latest.id, fixIndex: i }),
    });
    const body = (await res.json().catch(() => ({}))) as { applied?: boolean; message?: string; error?: string };
    setApplyBusy(null);
    setApplyResult((r) => ({
      ...r,
      [i]: { applied: Boolean(body.applied), message: body.message ?? body.error ?? `Failed (HTTP ${res.status}).` },
    }));
  }

  const [ideaBusy, setIdeaBusy] = useState<number | null>(null);
  const [ideaDone, setIdeaDone] = useState<Record<number, boolean>>({});
  async function draftIdea(i: number, c: { title: string; targetKeyword: string; type: string }) {
    setIdeaBusy(i);
    const res = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: c.type === "faq" ? "faq" : "blog", topic: c.title, keyword: c.targetKeyword }),
    });
    setIdeaBusy(null);
    if (res.ok) setIdeaDone((d) => ({ ...d, [i]: true }));
    else {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "Couldn't draft that piece.");
    }
  }

  async function draftGbp(i: number, action: string) {
    setGbpBusy(i);
    const res = await fetch("/api/seo/gbp-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setGbpBusy(null);
    if (res.ok) setGbpDone((d) => ({ ...d, [i]: true }));
    else {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "Couldn't draft the GBP post.");
    }
  }

  async function run() {
    setRunning(true);
    setError(null);
    const res = await fetch("/api/seo/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ focus: focus || undefined }),
    });
    setRunning(false);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? `Audit failed (HTTP ${res.status}).`);
    } else setFocus("");
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-full sm:w-80" placeholder="Optional focus, e.g. 'local SEO for Birmingham'" value={focus} onChange={(e) => setFocus(e.target.value)} />
        <button onClick={run} disabled={running} className="btn btn-primary">
          <IconSparkles className="h-4 w-4" />
          {running ? "Auditing…" : "Run SEO/GEO audit"}
        </button>
      </div>
      <p className="mt-2 text-xs text-faint">
        Reads your site live (plus your real Search Console data when connected) and returns a prioritised fix
        list. Fixes on pages Prism manages apply live with one click; anything else comes paste-ready.
      </p>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {running && (
        <WorkingState
          messages={[
            "Fetching your live site…",
            "Reading the search results…",
            "Auditing the on-page signals…",
            "Writing prioritised fixes…",
          ]}
          progress={null}
          className="mt-4"
        />
      )}

      {!latest?.data ? (
        running ? null : (
          <EmptyState className="mt-8" image="/empty/seo.webp" title="Your first audit is one click away.">
            Prism reads your site live — plus your real Search Console data when connected — checks the
            search results and competitors, and writes a prioritised fix list. Nothing changes on the
            site without your approval.
          </EmptyState>
        )
      ) : (
        <div className="mt-6 space-y-6">
          <Reveal>
            <div className="card p-5">
              <h2 className="font-display text-base font-semibold text-foreground">Health snapshot</h2>
              <p className="mt-1 text-sm text-muted">{latest.data.scoreSnapshot}</p>
              {latest.data.geoNotes && (
                <p className="mt-3 rounded-xl bg-accent-soft/50 p-3 text-sm"><span className="font-medium text-accent">GEO (rank for LLMs): </span>{latest.data.geoNotes}</p>
              )}
            </div>
          </Reveal>

          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">Prioritised fixes ({latest.data.fixes.length})</h2>
            <div className="space-y-3">
              {latest.data.fixes.map((f, i) => (
                <Reveal key={i} i={i}>
                  <div className="card p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-foreground/8 text-muted">{f.area}</span>
                      <span className={`badge ${impactTone[f.impact] ?? impactTone.low}`}>impact: {f.impact}</span>
                      <span className="badge bg-foreground/8 text-muted">effort: {f.effort}</span>
                      <span className="text-xs text-faint">{f.where}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-foreground">{f.what}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Field label="Current" value={f.currentValue} />
                      <Field label="Change to" value={f.exactChange} copy />
                    </div>
                    {f.jsonLd && f.jsonLd.trim() && <Field label="JSON-LD" value={f.jsonLd} copy mono />}
                    {f.targetUrl && f.fixKind && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => applyFix(i)}
                          disabled={applyBusy === i}
                          className="btn btn-secondary text-xs"
                        >
                          {applyBusy === i ? "Applying…" : "⚡ Apply live"}
                        </button>
                        {applyResult[i] && (
                          <span className={`text-xs ${applyResult[i].applied ? "text-success" : "text-muted"}`}>
                            {applyResult[i].message}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-5">
              <h3 className="font-display text-sm font-semibold text-foreground">Target keywords</h3>
              <div className="mt-3 space-y-2">
                {latest.data.keywords.map((k, i) => (
                  <div key={i} className="rounded-lg border border-border p-2.5 text-sm">
                    <div className="font-medium text-foreground">{k.keyword}</div>
                    <div className="text-xs text-muted">{k.intent} · opportunity: {k.opportunity}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card p-5">
              <h3 className="font-display text-sm font-semibold text-foreground">Content to create</h3>
              <p className="mt-1 text-xs text-faint">Draft these in the Content generator.</p>
              <div className="mt-3 space-y-2">
                {latest.data.contentIdeas.map((c, i) => (
                  <div key={i} className="rounded-lg border border-border p-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-accent-soft text-accent">{c.type}</span>
                      <span className="min-w-0 flex-1 font-medium text-foreground">{c.title}</span>
                      <button
                        onClick={() => draftIdea(i, c)}
                        disabled={ideaBusy === i || ideaDone[i]}
                        className="btn btn-secondary shrink-0 !py-1 text-xs"
                      >
                        {ideaBusy === i ? "Writing…" : ideaDone[i] ? "Drafted ✓" : "✍️ Draft it"}
                      </button>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{c.targetKeyword} · {c.intent}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {latest.data.gbpActions.length > 0 && (
            <div className="card p-5">
              <h3 className="font-display text-sm font-semibold text-foreground">Google Business Profile — this week</h3>
              <p className="mt-1 text-xs text-faint">
                Post-worthy actions become drafts on your calendar (published to Google Business after your
                approval). Profile changes (categories, services) are quick edits in your Business Profile.
              </p>
              <ul className="mt-3 space-y-2">
                {latest.data.gbpActions.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm text-muted">
                    <span className="min-w-0 flex-1">{a}</span>
                    <button
                      onClick={() => draftGbp(i, a)}
                      disabled={gbpBusy === i || gbpDone[i]}
                      className="btn btn-secondary shrink-0 text-xs"
                    >
                      {gbpBusy === i ? "Drafting…" : gbpDone[i] ? "Draft created ✓" : "📅 Draft GBP post"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {latest.data.caveats.length > 0 && (
            <p className="text-xs text-faint">Caveats: {latest.data.caveats.join(" · ")}</p>
          )}
        </div>
      )}

      {reports.length > 0 && (
        <details className="mt-10 rounded-2xl border border-border p-5">
          <summary className="cursor-pointer text-sm font-medium">Audit history ({reports.length})</summary>
          <div className="mt-4 space-y-4">
            {reports.map((r) => (
              <details key={r.id} className="rounded-xl border border-border p-4">
                <summary className="cursor-pointer text-sm">{r.title} <span className="text-xs text-faint">· {new Date(r.createdAt).toLocaleDateString("en-GB")}</span></summary>
                <div className="mt-3 whitespace-pre-wrap font-mono text-xs text-muted">{r.content}</div>
              </details>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Field({ label, value, copy, mono }: { label: string; value: string; copy?: boolean; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface/50 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
        {copy && (
          <button
            onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch {} }}
            className="text-[11px] text-accent underline"
          >
            {done ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      <p className={`mt-1 whitespace-pre-wrap break-words text-xs ${mono ? "font-mono" : ""} text-foreground`}>{value || "—"}</p>
    </div>
  );
}
