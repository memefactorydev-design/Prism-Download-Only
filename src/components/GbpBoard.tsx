"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { IconSparkles } from "@/components/ui/icons";
import { WorkingState } from "@/components/ui/Loading";
import { EmptyState } from "@/components/ui/EmptyState";

interface GbpData {
  reportMarkdown: string;
  snapshot: string;
  primaryCategory: string;
  secondaryCategories: string[];
  services: string[];
  attributes: string[];
  description: string;
  localKeywords: string[];
  reviewStrategy: string;
  posts: { title: string; body: string; cta: string }[];
  photoPlan: string[];
  caveats: string[];
}
export interface GbpReport {
  id: string;
  title: string;
  createdAt: string;
  data: GbpData | null;
}

export function GbpBoard({ reports }: { reports: GbpReport[] }) {
  const router = useRouter();
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = reports.find((r) => r.data) ?? null;

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/gbp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: location || undefined }) });
    setBusy(false);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "GBP research failed.");
    } else setLocation("");
    router.refresh();
  }

  const d = latest?.data;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-64" placeholder="City / area, e.g. Birmingham" value={location} onChange={(e) => setLocation(e.target.value)} />
        <button onClick={run} disabled={busy} className="btn btn-primary">
          <IconSparkles className="h-4 w-4" />
          {busy ? "Researching…" : "Research & optimise GBP"}
        </button>
      </div>
      <p className="mt-2 text-xs text-faint">
        Scrapes the local pack + competitors (Google Maps/SERP) and drafts a full optimisation plan + this week&apos;s posts.
        Posting to Google Business Profile is copy-and-paste for now — live auto-posting is coming.
      </p>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {busy && (
        <WorkingState
          messages={[
            "Reading the local pack…",
            "Studying nearby competitors…",
            "Choosing categories and services…",
            "Writing this week's posts…",
          ]}
          progress={null}
          className="mt-4"
        />
      )}

      {!d ? (
        busy ? null : (
          <EmptyState className="mt-8" image="/empty/seo.webp" title="Your local plan is one run away.">
            Prism reads the local pack and nearby competitors, then drafts a full Google Business
            optimisation plan — categories, services, description and this week&apos;s posts.
          </EmptyState>
        )
      ) : (
        <div className="mt-6 space-y-5">
          <Reveal>
            <div className="card p-5">
              <h2 className="font-display text-base font-semibold text-foreground">Local snapshot</h2>
              <p className="mt-1 text-sm text-muted">{d.snapshot}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Copyable label="Primary category" value={d.primaryCategory} />
                <Copyable label="Secondary categories" value={d.secondaryCategories.join(", ")} />
                <Copyable label="Services" value={d.services.join(", ")} />
                <Copyable label="Attributes" value={d.attributes.join(", ")} />
              </div>
              <Copyable label="Business description" value={d.description} block />
              <Copyable label="Local keywords" value={d.localKeywords.join(", ")} />
            </div>
          </Reveal>

          <div className="card p-5">
            <h3 className="font-display text-sm font-semibold text-foreground">This week&apos;s posts</h3>
            <div className="mt-3 space-y-2">
              {d.posts.map((p, i) => (
                <GbpPostCard key={i} post={p} />
              ))}
            </div>
            <p className="mt-3 text-xs text-faint">
              Send to Calendar creates a Google Business draft — it publishes through your connected
              Google Business channel after approval, or use copy for manual posting.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <h3 className="font-display text-sm font-semibold text-foreground">Review strategy</h3>
              <p className="mt-2 text-sm text-muted">{d.reviewStrategy}</p>
            </div>
            <div className="card p-5">
              <h3 className="font-display text-sm font-semibold text-foreground">Photo plan</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                {d.photoPlan.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          </div>
          {d.caveats.length > 0 && <p className="text-xs text-faint">Caveats: {d.caveats.join(" · ")}</p>}
        </div>
      )}
    </div>
  );
}

function GbpPostCard({ post }: { post: { title: string; body: string; cta: string } }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function sendToCalendar() {
    setState("busy");
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "gbp",
        format: "post",
        body: `${post.title}\n\n${post.body}\n\n${post.cta}`,
      }),
    });
    setState(res.ok ? "done" : "error");
  }
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{post.title}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={sendToCalendar}
            disabled={state === "busy" || state === "done"}
            className="btn btn-secondary text-xs"
          >
            {state === "done" ? "Draft created ✓" : state === "busy" ? "Sending…" : state === "error" ? "Failed — retry" : "Send to Calendar"}
          </button>
          <CopyBtn value={`${post.title}\n\n${post.body}\n\n${post.cta}`} />
        </div>
      </div>
      <p className="mt-1 text-sm text-muted">{post.body}</p>
      <p className="mt-1 text-xs text-accent">CTA: {post.cta}</p>
    </div>
  );
}

function Copyable({ label, value, block }: { label: string; value: string; block?: boolean }) {
  return (
    <div className={`rounded-lg border border-border bg-surface/50 p-2.5 ${block ? "mt-3" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
        <CopyBtn value={value} />
      </div>
      <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{value || "—"}</p>
    </div>
  );
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch {} }}
      className="text-[11px] text-accent underline"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
