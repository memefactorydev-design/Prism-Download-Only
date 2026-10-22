"use client";

import { useState } from "react";
import Link from "next/link";
import type { IntelSourceStatus } from "@/lib/intel";
import type { NamedAgent } from "@/lib/named-agents";

interface CacheInfo {
  fetchedAt: string;
  itemCount: number;
  brief: string;
}

interface RunResult {
  fetchedAt?: string;
  itemCount?: number;
  brief?: string;
  failures?: string[];
  error?: string;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

// Each source's natural posting channel (mirrors SOURCE_CHANNEL in
// /api/intel/[id]/draft). Sources absent here (houzz) have no posting channel.
const DRAFT_CHANNEL: Record<string, string> = {
  "fb-ads": "Facebook",
  instagram: "Instagram",
  "gmaps-reviews": "Google Business",
  pinterest: "Pinterest",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  viral: "Instagram",
  serp: "Google Business",
};

export function IntelBoard({
  sources,
  agents,
  enabled,
}: {
  sources: IntelSourceStatus[];
  agents: NamedAgent[];
  enabled: boolean;
}) {
  return (
    <div>
      <p className="mb-6 max-w-3xl text-sm text-muted">
        Each run becomes a market brief kept for a week. Fresh briefs feed the owning
        agent&apos;s chat (via the platform-intel toggle) and its nightly dream cycle, so the team
        reasons from real numbers rather than guesses.
      </p>

      {!enabled && (
        <div className="card mb-6 border-accent/40 p-5">
          <h2 className="text-sm font-semibold text-foreground">Prism Radar isn&apos;t connected yet</h2>
          <p className="mt-1 text-sm text-muted">
            Market Pulse runs on Prism Radar, our live research engine. Connect it on the{" "}
            <Link href="/connections" className="text-accent underline">
              Connections page
            </Link>{" "}
            to enable it — a light plan covers a weekly rhythm, and each run
            uses research credits. We only analyse public data.
          </p>
        </div>
      )}

      {enabled && sources.every((s) => !s.cache) && (
        <div className="mb-6 rounded-xl border border-dashed border-border p-5 text-sm text-muted">
          <p className="font-medium text-foreground">No market briefs yet — run your first sweep.</p>
          <p className="mt-1.5">
            Pick any card below and hit run: Prism reads what&rsquo;s working in your market right now and
            writes a brief your agents cite in chat and learn from overnight. Most owners start with the
            platform they post to most.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {sources.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            agent={agents.find((a) => a.id === source.agent)}
            enabled={enabled}
          />
        ))}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  agent,
  enabled,
}: {
  source: IntelSourceStatus;
  agent: NamedAgent | undefined;
  enabled: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(source.params.map((p) => [p.key, p.value]))
  );
  const [cache, setCache] = useState<CacheInfo | null>(source.cache);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const [draftState, setDraftState] = useState<"idle" | "busy" | "done">("idle");

  const agentName = agent?.name ?? source.agent;
  const draftChannel = DRAFT_CHANNEL[source.id];

  async function draftPost() {
    setDraftState("busy");
    setError(null);
    try {
      const res = await fetch(`/api/intel/${source.id}/draft`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { postId?: string; error?: string };
      if (res.ok && body.postId) {
        setDraftState("done");
        setSuccess(`Draft created for ${draftChannel} — finish and approve it on the Calendar.`);
      } else {
        setDraftState("idle");
        setError(body.error ?? `Draft failed (HTTP ${res.status}).`);
      }
    } catch (e) {
      setDraftState("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function scrape() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/intel/${source.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: values }),
      });
      const body = (await res.json().catch(() => ({}))) as RunResult;
      if (res.ok && body.fetchedAt && body.brief) {
        setCache({ fetchedAt: body.fetchedAt, itemCount: body.itemCount ?? 0, brief: body.brief });
        setSuccess(
          `${body.itemCount ?? 0} findings gathered — brief saved to ${agentName}'s memory.`
        );
        if (body.failures && body.failures.length > 0) {
          setWarning(`Some channels returned nothing: ${body.failures.join(" · ")}`);
        }
      } else {
        setError(body.error ?? `Scrape failed (HTTP ${res.status}).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold" style={agent ? { color: agent.color } : undefined}>
            {agent?.emoji ?? "🤖"} {agentName}
          </p>
          <h2 className="mt-0.5 text-sm font-semibold text-foreground">{source.label}</h2>
          
        </div>
      </div>

      <p className="mt-2 text-xs text-muted">{source.what}</p>

      <div className="mt-3 space-y-2">
        {source.params.map((p) => (
          <label key={p.key} className="block">
            <span className="mb-1 block text-xs text-muted">{p.label}</span>
            <input
              className="input"
              value={values[p.key] ?? ""}
              placeholder={p.default}
              onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {success && <p className="mt-3 text-sm text-success">{success}</p>}
      {warning && <p className="mt-1 text-sm text-amber-500">{warning}</p>}
      {busy && (
        <p className="mt-3 text-xs text-faint">
          Reading the live data, then distilling the brief — can take a couple of minutes.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {cache ? (
          <span className="text-xs text-success">
            ✓ last run: {formatWhen(cache.fetchedAt)} · {cache.itemCount} findings
          </span>
        ) : (
          <span className="text-xs text-faint">never run</span>
        )}
        <span className="flex items-center gap-2">
          {cache && (
            <button onClick={() => setShowBrief(true)} className="btn btn-secondary text-xs">
              View brief
            </button>
          )}
          {cache && draftChannel && (
            <button
              onClick={draftPost}
              disabled={draftState !== "idle"}
              title={`Turn this brief's strongest takeaway into a ${draftChannel} draft`}
              className="btn btn-secondary text-xs"
            >
              {draftState === "busy" ? "Drafting…" : draftState === "done" ? "Draft created ✓" : `Draft ${draftChannel} post`}
            </button>
          )}
          <button
            onClick={scrape}
            disabled={busy || !enabled}
            title={enabled ? undefined : "Connect Prism Radar on the Connections page first."}
            className="btn btn-primary text-xs"
          >
            {busy ? "Scraping…" : "Scrape now"}
          </button>
        </span>
      </div>

      {showBrief && cache && (
        <BriefModal
          title={`${source.label} — ${agentName}'s brief`}
          cache={cache}
          onClose={() => setShowBrief(false)}
        />
      )}
    </div>
  );
}

function BriefModal({
  title,
  cache,
  onClose,
}: {
  title: string;
  cache: CacheInfo;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      onClick={onClose}
    >
      <div className="card w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted">
              Scraped {formatWhen(cache.fetchedAt)} · {cache.itemCount} items
            </p>
          </div>
          <button onClick={onClose} className="btn btn-ghost text-xs">
            Close
          </button>
        </div>
        <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {cache.brief}
        </div>
      </div>
    </div>
  );
}
