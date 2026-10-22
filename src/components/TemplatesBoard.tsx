"use client";

import { useRouter } from "next/navigation";
import { GenerateVisual } from "@/components/ui/GenerateVisual";
import { useState } from "react";
import { WorkingState } from "@/components/ui/Loading";
import { EmptyState } from "@/components/ui/EmptyState";

export interface TemplateItem {
  id: string;
  niche: string;
  rank: number;
  title: string;
  format: string;
  blueprint: string;
  hook: string;
  whyItWorks: string | null;
  captions: Record<string, string>;
  hashtags: Record<string, string>;
  youtubeTitle: string | null;
  evidence: string | null;
  score: number | null;
  status: string;
  createdAt: string;
}

export interface ReportItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

// Platforms the agent writes copy for, and the formats each can be "used" as.
const COPY_PLATFORMS = [
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "linkedin",
  "pinterest",
  "gbp",
] as const;
type CopyPlatform = (typeof COPY_PLATFORMS)[number];

const PLATFORM_LABEL: Record<CopyPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  gbp: "Google Business",
};

const USE_FORMATS: Record<CopyPlatform, string[]> = {
  instagram: ["reel", "post", "carousel", "story"],
  facebook: ["reel", "post", "story"],
  tiktok: ["video"],
  youtube: ["short", "video"],
  linkedin: ["post", "carousel", "video"],
  pinterest: ["video", "post"],
  gbp: ["post"],
};

export function TemplatesBoard({
  templates,
  latestReport,
}: {
  templates: TemplateItem[];
  latestReport: ReportItem | null;
}) {
  const router = useRouter();
  const [niche, setNiche] = useState("");
  const [keywords, setKeywords] = useState("");
  const [focus, setFocus] = useState<
    "both" | "all" | "tiktok" | "instagram" | "youtube" | "pinterest"
  >("both");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runResearch() {
    if (!niche.trim()) {
      setError("Enter a niche to research.");
      return;
    }
    setRunning(true);
    setError(null);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        niche,
        keywords: keywords || undefined,
        platformFocus: focus,
      }),
    });
    setRunning(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Research failed (HTTP ${res.status}).`);
    }
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          placeholder="Niche, e.g. 'before-and-after reveals' or 'barber transformations' — any niche works"
          className="w-80 rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm "
        />
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="Optional keywords (comma-separated)"
          className="w-64 rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm "
        />
        <select
          value={focus}
          onChange={(e) =>
            setFocus(
              e.target.value as
                | "both"
                | "all"
                | "tiktok"
                | "instagram"
                | "youtube"
                | "pinterest",
            )
          }
          className="rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm  "
        >
          <option value="both">TikTok + Instagram</option>
          <option value="all">All (TikTok + IG + YouTube + Pinterest)</option>
          <option value="tiktok">TikTok only</option>
          <option value="instagram">Instagram only</option>
          <option value="youtube">YouTube only</option>
          <option value="pinterest">Pinterest only</option>
        </select>
        <button
          onClick={runResearch}
          disabled={running}
          className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? "Researching… (1–2 min)" : "Research templates"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {running && (
        <WorkingState
          messages={[
            "Scraping the trending edits…",
            "Analysing the top performers…",
            "Building your blueprints…",
            "Writing captions and hashtags…",
          ]}
          progress={null}
          className="mt-4"
        />
      )}

      {templates.length === 0 ? (
        running ? null : (
          <EmptyState className="mt-8" image="/empty/templates.webp" title="Your first blueprints are one niche away.">
            Enter a niche and run research — we study the top-performing short-form content in that
            niche (public data only) and turn each hit into a ranked, step-by-step blueprint with
            ready-to-post captions and hashtags for every platform.
          </EmptyState>
        )
      ) : (
        <div className="mt-8 space-y-4">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      )}

      {latestReport && (
        <details className="mt-10 rounded-2xl border border-border p-5 ">
          <summary className="cursor-pointer text-sm font-medium">
            Full research overview: {latestReport.title}
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

function TemplateCard({
  template,
  onChanged,
}: {
  template: TemplateItem;
  onChanged: () => void;
}) {
  const router = useRouter();
  const available = COPY_PLATFORMS.filter(
    (p) => (template.captions[p] ?? "").trim().length > 0,
  );
  const [platform, setPlatform] = useState<CopyPlatform>(
    available[0] ?? "instagram",
  );
  const [useFormat, setUseFormat] = useState<string>(
    USE_FORMATS[available[0] ?? "instagram"][0],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickPlatform(p: CopyPlatform) {
    setPlatform(p);
    setUseFormat(USE_FORMATS[p][0]);
  }

  async function useInCalendar() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "use",
        channel: platform,
        format: useFormat,
      }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/calendar");
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not create a draft.");
    }
  }

  async function setStatus(status: string) {
    await fetch(`/api/templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onChanged();
  }

  const caption = template.captions[platform] ?? "";
  const tags = template.hashtags[platform] ?? "";

  return (
    <div className="rounded-2xl border border-border p-5 ">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-accent text-sm font-semibold text-white">
            {template.rank}
          </span>
          <h2 className="font-medium">{template.title}</h2>
          <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-xs text-muted">
            {template.format}
          </span>
          <span
            className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700 dark:bg-violet-950 dark:text-violet-300"
            title="Researched niche"
          >
            {template.niche}
          </span>
        </div>
        {template.score != null && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            {template.score}/100
          </span>
        )}
      </div>

      <p className="mt-3 text-sm">
        <span className="text-muted">Hook: </span>
        {template.hook}
      </p>
      {template.whyItWorks && (
        <p className="mt-1 text-sm">
          <span className="text-muted">Why it works: </span>
          {template.whyItWorks}
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">
          Editing blueprint
        </summary>
        <div className="mt-2 whitespace-pre-wrap rounded-lg bg-foreground/5 p-3 text-sm leading-relaxed text-muted">
          {template.blueprint}
        </div>
      </details>

      {/* Per-platform copy */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {available.map((p) => (
          <button
            key={p}
            onClick={() => pickPlatform(p)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              platform === p
                ? "bg-gradient-accent text-white"
                : "border border-border-strong"
            }`}
          >
            {PLATFORM_LABEL[p]}
          </button>
        ))}
      </div>

      {platform === "youtube" && template.youtubeTitle && (
        <CopyField label="YouTube title" value={template.youtubeTitle} />
      )}
      <CopyField
        label={platform === "youtube" ? "Description" : "Caption"}
        value={caption}
        multiline
      />
      <CopyField
        label={platform === "youtube" ? "Tags" : "Hashtags"}
        value={tags}
      />

      {template.evidence && (
        <p className="mt-2 truncate text-xs text-muted">
          Evidence:{" "}
          <a
            href={template.evidence}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {template.evidence}
          </a>
        </p>
      )}

      {/* Use in calendar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Use as</span>
        <select
          value={platform}
          onChange={(e) => pickPlatform(e.target.value as CopyPlatform)}
          className="rounded-lg border border-border-strong bg-transparent px-2 py-1.5 text-xs  "
        >
          {available.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
        <select
          value={useFormat}
          onChange={(e) => setUseFormat(e.target.value)}
          className="rounded-lg border border-border-strong bg-transparent px-2 py-1.5 text-xs  "
        >
          {USE_FORMATS[platform].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          onClick={useInCalendar}
          disabled={busy || available.length === 0}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Use in Calendar"}
        </button>
        <button
          onClick={() => router.push(`/studio?template=${template.id}`)}
          className="rounded-lg bg-gradient-accent px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
          title="Auto-generate a reel from your footage following this blueprint"
        >
          Use in Studio
        </button>
        <GenerateVisual
          kind="image"
          prompt={`Scroll-stopping social visual matching this viral blueprint. "${template.title}". ${template.blueprint.slice(0, 500)}. Photoreal, premium, vertical-friendly, no text.`}
          title={`Visual — ${template.title.slice(0, 60)}`}
        />
        <GenerateVisual
          kind="video"
          prompt={`Short cinematic vertical social clip matching this viral blueprint. "${template.title}". ${template.blueprint.slice(0, 500)}. Premium, energetic, no text.`}
          title={`Clip — ${template.title.slice(0, 60)}`}
        />
        {template.status !== "saved" && (
          <button
            onClick={() => setStatus("saved")}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-xs "
          >
            Save
          </button>
        )}
        <button
          onClick={() => setStatus("archived")}
          className="rounded-lg border border-border-strong px-3 py-1.5 text-xs text-red-500 "
        >
          Archive
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function CopyField({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — user can select manually
    }
  }
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <button onClick={copy} className="text-xs text-muted underline">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p
        className={`mt-0.5 rounded-lg bg-foreground/5 p-2 text-sm  ${multiline ? "whitespace-pre-wrap" : "truncate"}`}
      >
        {value || <span className="text-faint">—</span>}
      </p>
    </div>
  );
}
