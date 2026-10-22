"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/Segmented";
import { WorkingState } from "@/components/ui/Loading";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconFlame } from "@/components/ui/icons";

export interface InsightDTO {
  id: string;
  platform: string;
  topic: string;
  rank: number;
  title: string;
  hook: string;
  format: string;
  pacing: string | null;
  sound: string | null;
  whyItWorks: string | null;
  evidence: string | null;
  score: number | null;
}

export function TrendResearch({ initialInsights }: { initialInsights: InsightDTO[] }) {
  const router = useRouter();
  const [platform, setPlatform] = useState<"tiktok" | "instagram" | "youtube" | "linkedin" | "pinterest" | "facebook">("tiktok");
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightDTO[]>(initialInsights);

  async function run() {
    if (!topic.trim()) {
      setError("Enter a topic to research.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, topic, keywords }),
      });
      const body = (await res.json().catch(() => ({}))) as { insights?: InsightDTO[]; error?: string };
      if (res.ok && body.insights) {
        setInsights([...body.insights, ...insights]);
        router.refresh();
      } else {
        setError(body.error ?? "Trend research failed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Viral trend research</h2>
          <p className="text-xs text-muted">
            Scrapes top performers and feeds the patterns into your edits & montages.
          </p>
        </div>
        <Segmented
          value={platform}
          onChange={setPlatform}
          options={[
            { value: "tiktok", label: "TikTok" },
            { value: "instagram", label: "Instagram" },
            { value: "youtube", label: "YouTube" },
            { value: "linkedin", label: "LinkedIn" },
            { value: "pinterest", label: "Pinterest" },
            { value: "facebook", label: "Facebook" },
          ]}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-40">
          <span className="mb-1 block text-xs text-muted">Topic</span>
          <input
            className="input"
            placeholder={platform === "linkedin" ? "e.g. your industry or service" : "e.g. before-and-after reveals in your niche"}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        <label className="flex-1 min-w-40">
          <span className="mb-1 block text-xs text-muted">Keywords (optional)</span>
          <input
            className="input"
            placeholder={platform === "linkedin" ? "your industry, your service" : "football, slow-mo, crowd"}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </label>
        <button onClick={run} disabled={busy} className="btn btn-primary">
          {busy ? "Researching…" : "Research trends"}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-faint">
        Research reads live public data (subject to each platform&apos;s terms) and uses research
        credits. We analyse patterns only — never re-using anyone else&apos;s content.
        {platform === "linkedin" && " LinkedIn research searches the best-performing recent posts for your topic."}
        {platform === "facebook" && " Facebook research reads the Ad Library: ads that keep running are ads that work — the patterns apply to organic posts too."}
        {platform === "pinterest" && " Pinterest research finds the top pins for your topic — Pinterest is a search engine, so patterns centre on titles and keywords."}
      </p>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {busy && (
        <WorkingState
          messages={[
            "Scraping the top performers…",
            "Reading the public posts…",
            "Spotting the winning patterns…",
            "Writing your trend brief…",
          ]}
          progress={null}
          className="mt-4"
        />
      )}

      {insights.length === 0 && !busy && (
        <EmptyState className="mt-6" image="/empty/trends.webp" title="Your first trend scan starts here.">
          Enter your niche above and Prism reads what&rsquo;s winning right now — the hooks, formats and
          pacing behind the top performers. Every brief can become a calendar draft in one tap, and the
          Studio uses them to cut your reels the way the winners are cut.
        </EmptyState>
      )}

      {insights.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {insights.slice(0, 8).map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function InsightCard({ insight: i }: { insight: InsightDTO }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function draft() {
    setState("busy");
    const res = await fetch(`/api/trends/${i.id}/draft`, { method: "POST" });
    setState(res.ok ? "done" : "error");
  }
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="badge bg-accent-soft text-accent">{i.platform}</span>
          {i.topic && <span className="badge bg-foreground/8 text-muted">{i.topic}</span>}
        </span>
        {i.score != null && (
          <span className="badge bg-foreground/8 text-muted" title={i.whyItWorks ?? undefined}>
            <IconFlame className="h-3 w-3" />
            {i.score}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm font-semibold text-foreground">{i.title}</p>
      <p className="mt-0.5 text-xs text-muted">
        <span className="text-foreground">Hook:</span> {i.hook}
      </p>
      <p className="mt-0.5 text-xs text-muted">{i.format}{i.pacing ? ` · ${i.pacing}` : ""}{i.sound ? ` · ${i.sound}` : ""}</p>
      <button
        onClick={draft}
        disabled={state === "busy" || state === "done"}
        title="Apply this pattern to a ready-to-edit calendar draft for the matching channel"
        className="btn btn-secondary mt-2 text-xs"
      >
        {state === "done" ? "Draft created ✓" : state === "busy" ? "Drafting…" : state === "error" ? "Failed — retry" : "Draft post"}
      </button>
    </div>
  );
}
