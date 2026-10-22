"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WorkingState } from "@/components/ui/Loading";
import { EmptyState } from "@/components/ui/EmptyState";

export interface IdeaItem {
  id: string;
  rank: number;
  title: string;
  hook: string;
  format: string;
  targetAudience: string;
  evidence: string | null;
  brandAngle: string | null;
  status: string;
  createdAt: string;
}

export interface ReportItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  shortlisted: "Shortlisted",
  in_production: "In production",
  used: "Used",
  archived: "Archived",
};

export function IdeasBoard({
  ideas,
  latestReport,
}: {
  ideas: IdeaItem[];
  latestReport: ReportItem | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runResearch() {
    setRunning(true);
    setError(null);
    const res = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query || undefined }),
    });
    setRunning(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Research failed (HTTP ${res.status}).`);
    } else {
      setQuery("");
    }
    router.refresh();
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/ideas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Research focus, e.g. your flagship product or a service + area"
          className="w-80 rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm "
        />
        <button
          onClick={runResearch}
          disabled={running}
          className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? "Researching… (about a minute)" : "Run research"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {running && (
        <WorkingState
          messages={[
            "Researching your niche…",
            "Reading live sources…",
            "Finding the strongest angles…",
            "Drafting ranked ideas…",
          ]}
          progress={null}
          className="mt-4"
        />
      )}

      {ideas.length === 0 ? (
        running ? null : (
          <EmptyState className="mt-8" image="/empty/ideas.webp" title="Your first ranked ideas are one run away.">
            Type a focus above (or leave it empty to use your brand&rsquo;s keywords) and run research — the
            agent searches the Meta Ad Library for what&apos;s actually working on YOUR topic right now,
            weights long-running ads as proven spend, and writes ranked idea briefs.
          </EmptyState>
        )
      ) : (
        <div className="mt-8 space-y-4">
          {ideas.map((idea) => (
            <div
              key={idea.id}
              className="rounded-2xl border border-border p-5 "
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-baseline gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-accent text-sm font-semibold text-white">
                    {idea.rank}
                  </span>
                  <h2 className="font-medium">{idea.title}</h2>
                </div>
                <span className="shrink-0 rounded-full bg-foreground/8 px-2 py-0.5 text-xs">
                  {STATUS_LABELS[idea.status] ?? idea.status}
                </span>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Hook">{idea.hook}</Row>
                <Row label="Format">{idea.format}</Row>
                <Row label="Audience">{idea.targetAudience}</Row>
                {idea.evidence && <Row label="Evidence">{idea.evidence}</Row>}
                {idea.brandAngle && (
                  <Row label="Brand angle">{idea.brandAngle}</Row>
                )}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {["shortlisted", "in_production", "used", "archived"]
                  .filter((s) => s !== idea.status)
                  .map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(idea.id, s)}
                      className="rounded-lg border border-border-strong px-3 py-1.5 text-xs "
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {latestReport && (
        <details className="mt-10 rounded-2xl border border-border p-5 ">
          <summary className="cursor-pointer text-sm font-medium">
            Full research brief: {latestReport.title}
            <span className="ml-2 text-xs font-normal text-muted">
              {new Date(latestReport.createdAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </summary>
          <div className="mt-4 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
            {latestReport.content}
          </div>
        </details>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
