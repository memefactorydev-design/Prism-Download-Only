"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { IconSparkles } from "@/components/ui/icons";
import { WorkingState, Skeleton } from "@/components/ui/Loading";
import { EmptyState } from "@/components/ui/EmptyState";

const IMAGE_GEN_MESSAGES = [
  "Briefing Prism Lens…",
  "Composing the shot…",
  "Refracting the light…",
  "Rendering your image…",
];
const VIDEO_GEN_MESSAGES = [
  "Storyboarding the motion…",
  "Rendering frames…",
  "This usually takes 2–5 minutes…",
  "Polishing the final cut…",
];
const FILM_GEN_MESSAGES = [
  "The director is planning the shots…",
  "Rendering the segments…",
  "Recording the voice-over…",
  "Stitching the final cut…",
];

// ── API shapes (local copies — all data arrives via fetch, never lib imports) ──

interface AdVariant {
  name: string;
  hook: string;
  primary_text: string;
  headline: string;
  cta: string;
  hashtags: string[];
  image_prompt: string;
  video_prompt: string;
}

interface AdPack {
  strategy: string;
  variants: AdVariant[];
}

interface AdPackResponse {
  agent?: string;
  intel?: string;
  pack?: AdPack;
  error?: string;
}

interface AssetRef {
  id: string;
  url: string;
}

interface AssetResponse {
  asset?: AssetRef;
  error?: string;
}

interface VideoStartResponse {
  operation?: string;
  error?: string;
}

interface VideoPollResponse {
  done?: boolean;
  asset?: AssetRef;
  error?: string;
}

// ── Options ──

const PLATFORMS: { value: string; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
  { value: "pinterest", label: "Pinterest" },
  { value: "houzz", label: "Houzz" },
  { value: "gmb", label: "Google Business" },
  { value: "blog", label: "Blog" },
];

const OBJECTIVES = ["lead generation", "brand awareness", "visits & bookings", "online sales", "retargeting", "viral reach"];

// Channels the Calendar can actually publish to; anything else drafts as Instagram.
// Ad Studio's "gmb" platform maps to the Calendar's "gbp" channel.
const CALENDAR_CHANNELS = ["instagram", "facebook", "tiktok", "linkedin", "youtube", "pinterest", "gbp"];
const CALENDAR_ALIAS: Record<string, string> = { gmb: "gbp" };

const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_ATTEMPTS = 60; // ~10 minutes

export function AdStudioBoard({
  geminiConnected,
  engineReady,
  falConnected = false,
}: {
  geminiConnected: boolean;
  /** The AI engine (a Claude Code / Codex sign-in, or an API key) can write copy. */
  engineReady: boolean;
  falConnected?: boolean;
}) {
  const [platform, setPlatform] = useState("instagram");
  const [objective, setObjective] = useState(OBJECTIVES[0]);
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [notes, setNotes] = useState("");
  const [research, setResearch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdPackResponse | null>(null);
  // The owner's photo library — selected photos ground image editing (Nano
  // Banana) and become Veo's first frame, so ads use real footage.
  const [library, setLibrary] = useState<{ id: string; name: string }[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/media")
      .then((r) => r.json())
      .then((b: { media?: { id: string; originalName: string; mimeType: string }[] }) => {
        const items = (b.media ?? []).filter((m) => m.mimeType.startsWith("image/"));
        setLibrary(items.map((m) => ({ id: m.id, name: m.originalName })));
      })
      .catch(() => {});
  }, []);

  function toggleAsset(id: string) {
    setSelectedAssets((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : prev.length >= 3 ? prev : [...prev, id]
    );
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/adstudio/adpack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, objective, offer, audience, notes, research, sourceImageCount: selectedAssets.length }),
    });
    const data = (await res.json().catch(() => ({}))) as AdPackResponse;
    setBusy(false);
    if (!res.ok || !data.pack) {
      setError(data.error ?? `Ad pack generation failed (HTTP ${res.status}).`);
      return;
    }
    setResult(data);
  }

  return (
    <div>
      {!geminiConnected && (
        <div className="card border-accent/40 mb-5 p-5">
          <h2 className="font-display text-base font-semibold text-foreground">Prism Lens isn&apos;t connected yet</h2>
          <p className="mt-1 text-sm text-muted">
            AI images, video and Scout&apos;s live competitor research all run on Prism Lens.
            {engineReady
              ? " Ad copy still works via Prism Mind, but the visual half stays off until it's connected."
              : " Prism Mind isn't ready either (no AI engine signed in), so ad copy won't generate yet."}
          </p>
          <Link href="/connections" className="btn btn-primary mt-3 text-xs">
            Connect Prism Lens on the Connections page
          </Link>
        </div>
      )}

      {/* Brief */}
      <div className="card p-5">
        <h2 className="font-display text-base font-semibold text-foreground">The brief</h2>
        <p className="mt-1 text-sm text-muted">
          Tell the team what you&apos;re promoting and who it&apos;s for — the platform&apos;s named agent writes three
          genuinely different angles.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-foreground">Platform</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="input mt-1">
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-foreground">Objective</span>
            <select value={objective} onChange={(e) => setObjective(e.target.value)} className="input mt-1">
              {OBJECTIVES.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-foreground">Offer / hook</span>
            <input
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              placeholder="e.g. Free consultation, launch offer, open day…"
              className="input mt-1"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-foreground">Audience</span>
            <input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g. Local homeowners planning a big purchase this year"
              className="input mt-1"
            />
          </label>
        </div>

        <label className="mt-3 block text-sm">
          <span className="font-medium text-foreground">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything the agent should know — range to feature, tone, what's worked before…"
            className="input mt-1"
          />
        </label>

        <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={research}
            onChange={(e) => setResearch(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Scout researches live competitor ads first (slower, better)
        </label>

        {library.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">
              Ground the ads in your real photos <span className="text-xs font-normal text-faint">(optional — pick up to 3)</span>
            </p>
            <p className="mt-0.5 text-xs text-faint">
              Selected photos are edited into the ad image, and the first one becomes the opening
              frame of the video — your actual work, not stock.
            </p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {library.slice(0, 24).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleAsset(m.id)}
                  title={m.name}
                  className={`h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border-2 transition ${
                    selectedAssets.includes(m.id) ? "border-[var(--accent)] shadow-glow" : "border-border opacity-80 hover:opacity-100"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/media/${m.id}/file`} alt={m.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button onClick={generate} disabled={busy} className="btn btn-primary">
            <IconSparkles className="h-4 w-4" />
            {busy ? "Working…" : "Generate ad pack"}
          </button>
        </div>
        {busy && (
          <WorkingState
            className="mt-4"
            messages={[
              "Scout is researching your offer…",
              `Your ${platformLabel(platform)} agent is drafting variants…`,
              "Writing hooks, copy and CTAs…",
              "Designing the creative brief…",
            ]}
            progress={null}
          />
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {/* Results */}
      {!result && !busy && (
        <EmptyState className="mt-6" title="Your first ad pack is one brief away.">
          Describe the offer and who it&rsquo;s for above, pick up to three of your real photos, and Prism
          drafts complete ad variants: the copy, the image, the video. Refine anything with a note, then
          send the winner to your calendar.
        </EmptyState>
      )}

      {result?.pack && (
        <div className="mt-6 space-y-5">
          <Reveal>
            <div className="card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-foreground">Creative strategy</h2>
                {result.agent && (
                  <span className="badge bg-accent-soft text-accent">{result.agent} · {platformLabel(platform)}</span>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{result.pack.strategy}</p>
              {result.intel && (
                <details className="mt-3 rounded-xl border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    Scout&apos;s live market intelligence
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
                    {result.intel}
                  </div>
                </details>
              )}
            </div>
          </Reveal>

          {result.pack.variants.map((v, i) => (
            <Reveal key={`${v.name}-${i}`} i={i + 1}>
              <VariantCard variant={v} platform={platform} geminiConnected={geminiConnected} falConnected={falConnected} sourceAssetIds={selectedAssets} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}

function platformLabel(value: string): string {
  return PLATFORMS.find((p) => p.value === value)?.label ?? value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function VariantCard({
  variant,
  platform,
  geminiConnected,
  falConnected,
  sourceAssetIds,
}: {
  variant: AdVariant;
  platform: string;
  geminiConnected: boolean;
  falConnected: boolean;
  sourceAssetIds: string[];
}) {
  const [imagePrompt, setImagePrompt] = useState(variant.image_prompt);
  const [videoPrompt, setVideoPrompt] = useState(variant.video_prompt);
  // Seedance (fal) is the primary video engine; Veo (Gemini) is the backup.
  const [videoEngine, setVideoEngine] = useState(falConnected ? "seedance" : "veo");

  const [imageAsset, setImageAsset] = useState<AssetRef | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const [videoAsset, setVideoAsset] = useState<AssetRef | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  const [draftBusy, setDraftBusy] = useState(false);
  const [draftDone, setDraftDone] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Refine loops: follow-up notes applied to what was just generated —
  // the running log under each asset keeps the conversation visible.
  const [imageRefine, setImageRefine] = useState("");
  const [videoRefine, setVideoRefine] = useState("");
  const [imageNotes, setImageNotes] = useState<string[]>([]);
  const [videoNotes, setVideoNotes] = useState<string[]>([]);

  // The stitched ad film: a worker job (segments → concat → VO + captions).
  const [filmSecs, setFilmSecs] = useState(24);
  const [filmStage, setFilmStage] = useState<string | null>(null);
  const [filmProgress, setFilmProgress] = useState<number | null>(null);
  const [filmStartedAt, setFilmStartedAt] = useState<number | undefined>(undefined);
  const [filmError, setFilmError] = useState<string | null>(null);
  const [filmAsset, setFilmAsset] = useState<AssetRef | null>(null);

  // Stop the video poll loop touching state after unmount.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const assetTitle = `${platform} ad — ${variant.name}`;

  async function generateImage(opts?: { prompt: string; assetIds: string[] }) {
    setImageBusy(true);
    setImageError(null);
    const res = await fetch("/api/adstudio/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: opts?.prompt ?? imagePrompt,
        title: assetTitle,
        assetIds: opts?.assetIds ?? sourceAssetIds,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as AssetResponse;
    if (!alive.current) return;
    setImageBusy(false);
    if (!res.ok || !data.asset) {
      setImageError(data.error ?? `Image generation failed (HTTP ${res.status}).`);
      return;
    }
    setImageAsset(data.asset);
  }

  // Refine = edit the GENERATED image itself (it's a normal media asset, so it
  // goes back through the engine as the source with your note as the change).
  async function refineImage() {
    if (!imageAsset || !imageRefine.trim()) return;
    const note = imageRefine.trim();
    setImageRefine("");
    setImageNotes((n) => [...n, note]);
    await generateImage({ prompt: note, assetIds: [imageAsset.id] });
  }

  async function generateVideo(promptOverride?: string) {
    setVideoBusy(true);
    setVideoError(null);
    setVideoProgress("Sending the brief to the video engine…");
    const res = await fetch("/api/adstudio/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: promptOverride ?? videoPrompt,
        imageAssetId: sourceAssetIds[0] || undefined,
        engine: videoEngine,
        title: assetTitle,
      }),
    });
    const started = (await res.json().catch(() => ({}))) as VideoStartResponse & VideoPollResponse;
    if (!alive.current) return;
    // Kling (fal.ai) runs synchronously — the asset comes straight back.
    if (res.ok && started.done && started.asset) {
      setVideoBusy(false);
      setVideoProgress(null);
      setVideoAsset(started.asset);
      return;
    }
    if (!res.ok || !started.operation) {
      setVideoBusy(false);
      setVideoProgress(null);
      setVideoError(started.error ?? `Video generation failed to start (HTTP ${res.status}).`);
      return;
    }

    const pollUrl = `/api/adstudio/video?op=${encodeURIComponent(started.operation)}&title=${encodeURIComponent(assetTitle)}`;
    // Hand narration to <WorkingState> (rotating messages + live timer) — clearing
    // the label lets it cycle the reassurance lines instead of a verbose counter.
    if (alive.current) setVideoProgress(null);
    for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      if (!alive.current) return;
      const poll = await fetch(pollUrl);
      const status = (await poll.json().catch(() => ({}))) as VideoPollResponse;
      if (!alive.current) return;
      if (!poll.ok) {
        setVideoBusy(false);
        setVideoProgress(null);
        setVideoError(status.error ?? `Video polling failed (HTTP ${poll.status}).`);
        return;
      }
      if (status.done) {
        setVideoBusy(false);
        setVideoProgress(null);
        if (status.error || !status.asset) {
          setVideoError(status.error ?? "The engine finished without returning a video.");
        } else {
          setVideoAsset(status.asset);
        }
        return;
      }
    }
    setVideoBusy(false);
    setVideoProgress(null);
    setVideoError("Timed out after 10 minutes — the render may still finish; check the Media library shortly.");
  }

  // Video engines can't edit an existing clip — a refine re-shoots it with
  // your note added to the brief (honest label in the UI).
  async function refineVideo() {
    if (!videoRefine.trim()) return;
    const note = videoRefine.trim();
    setVideoRefine("");
    // Re-shoots start from the ORIGINAL brief, so carry every note forward.
    const allNotes = [...videoNotes, note];
    setVideoNotes(allNotes);
    await generateVideo(`${videoPrompt}\n\nRefinement notes (apply ALL):\n${allNotes.map((v, i) => `${i + 1}. ${v}`).join("\n")}`);
  }

  // Enqueue the stitched ad film and follow the worker job to completion.
  async function generateFilm() {
    setFilmError(null);
    setFilmAsset(null);
    setFilmStage("Queued");
    setFilmProgress(null);
    setFilmStartedAt(Date.now());
    const res = await fetch("/api/adstudio/film", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `${variant.hook}\n\n${variant.primary_text}\n\nVisual brief: ${videoPrompt}\nPlatform: ${platform}. CTA: ${variant.cta}.`,
        targetSecs: filmSecs,
        imageAssetId: sourceAssetIds[0] || undefined,
        title: assetTitle,
      }),
    });
    const started = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
    if (!alive.current) return;
    if (!res.ok || !started.jobId) {
      setFilmStage(null);
      setFilmError(started.error ?? `Could not start the ad film (HTTP ${res.status}).`);
      return;
    }
    for (;;) {
      await sleep(4000);
      if (!alive.current) return;
      const poll = await fetch(`/api/studio/jobs/${started.jobId}`);
      const view = (await poll.json().catch(() => ({}))) as {
        job?: { status: string; stage: string | null; progress: number; errorMessage?: string | null };
        clips?: { assetId: string | null }[];
        error?: string;
      };
      if (!alive.current) return;
      if (!poll.ok || !view.job) {
        setFilmStage(null);
        setFilmError(view.error ?? `Job polling failed (HTTP ${poll.status}).`);
        return;
      }
      setFilmStage(view.job.stage);
      setFilmProgress(view.job.progress > 0 ? view.job.progress : null);
      if (["complete", "partial"].includes(view.job.status)) {
        const assetId = view.clips?.find((c) => c.assetId)?.assetId;
        setFilmStage(null);
        if (assetId) setFilmAsset({ id: assetId, url: `/api/media/${assetId}/file` });
        else setFilmError("The film rendered but no clip came back — check the Studio board.");
        return;
      }
      if (view.job.status === "failed") {
        setFilmStage(null);
        setFilmError(view.job.errorMessage ?? "The ad film failed.");
        return;
      }
    }
  }

  async function draftInCalendar() {
    setDraftBusy(true);
    setDraftError(null);
    const mediaIds = [imageAsset?.id, videoAsset?.id, filmAsset?.id].filter((id): id is string => Boolean(id));
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: (() => {
          const mapped = CALENDAR_ALIAS[platform] ?? platform;
          return CALENDAR_CHANNELS.includes(mapped) ? mapped : "instagram";
        })(),
        format: "post",
        title: variant.name,
        body: `${variant.hook}\n\n${variant.primary_text}\n\n${variant.headline} — ${variant.cta}`,
        hashtags: variant.hashtags.join(" "),
        // The posts API (PostInput) reads `mediaIds`; keep any generated assets attached.
        mediaIds,
        mediaAssetIds: mediaIds,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { post?: unknown; error?: string };
    if (!alive.current) return;
    setDraftBusy(false);
    if (!res.ok || !data.post) {
      setDraftError(data.error ?? `Could not create a draft (HTTP ${res.status}).`);
      return;
    }
    setDraftDone(true);
  }

  return (
    <div className="card p-5">
      <h3 className="font-display text-base font-semibold text-foreground">{variant.name}</h3>
      <p className="mt-1.5 text-sm font-medium text-accent">{variant.hook}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{variant.primary_text}</p>
      <p className="mt-2 text-sm text-foreground">
        {variant.headline} — <span className="text-accent">{variant.cta}</span>
      </p>
      {variant.hashtags.length > 0 && (
        <p className="mt-1.5 text-xs text-faint">{variant.hashtags.join(" ")}</p>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="block text-sm">
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Image prompt</span>
          <textarea
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            rows={3}
            className="input mt-1 font-mono text-xs"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Video prompt</span>
          <textarea
            value={videoPrompt}
            onChange={(e) => setVideoPrompt(e.target.value)}
            rows={3}
            className="input mt-1 font-mono text-xs"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => generateImage()}
          disabled={imageBusy || !geminiConnected || !imagePrompt.trim()}
          className="btn btn-secondary text-xs"
          title={geminiConnected ? undefined : "Connect Prism Lens on the Connections page first"}
        >
          {imageBusy ? "Generating image…" : "🖼 Generate image"}
        </button>
        <button
          onClick={() => generateVideo()}
          disabled={videoBusy || (videoEngine === "seedance" ? !falConnected : !geminiConnected) || !videoPrompt.trim()}
          className="btn btn-secondary text-xs"
          title={
            falConnected || geminiConnected ? undefined : "Connect Prism Motion (or Prism Lens) on the Connections page first"
          }
        >
          {videoBusy ? "Rendering video…" : "🎬 Generate clip"}
        </button>
        {falConnected && geminiConnected && (
          <select value={videoEngine} onChange={(e) => setVideoEngine(e.target.value)} className="input w-auto py-1 text-[11px]" title="Video engine">
            <option value="seedance">Prism Motion</option>
            <option value="veo">Prism Lens</option>
          </select>
        )}
        <button
          onClick={generateFilm}
          disabled={Boolean(filmStage) || (!falConnected && !geminiConnected) || !videoPrompt.trim()}
          className="btn btn-primary text-xs"
          title="The director agent plans segments within the engine's per-render time limit, renders each, then stitches one cut with the voice-over and captions"
        >
          {filmStage ? "Filming…" : "🎞 Full ad film (VO + captions)"}
        </button>
        <select value={filmSecs} onChange={(e) => setFilmSecs(Number(e.target.value))} className="input w-auto py-1 text-[11px]" title="Target length">
          <option value={16}>~16s</option>
          <option value={24}>~24s</option>
          <option value={36}>~36s</option>
          <option value={48}>~48s</option>
        </select>
        <button onClick={draftInCalendar} disabled={draftBusy || draftDone} className="btn btn-secondary text-xs">
          {draftBusy ? "Creating draft…" : draftDone ? "Draft created ✓" : "📅 Draft in Calendar"}
        </button>
      </div>
      {falConnected && (
        <p className="mt-2 text-[11px] text-faint">
          The director may add AI morph transitions between shots (~$1 per bridge, max 2 per film).
        </p>
      )}
      {imageError && <p className="mt-2 text-xs text-danger">{imageError}</p>}
      {imageBusy && !imageAsset && (
        <div className="mt-4 max-w-md">
          <Skeleton className="h-64 w-full rounded-xl" />
          <WorkingState variant="inline" className="mt-2" messages={IMAGE_GEN_MESSAGES} />
        </div>
      )}
      {videoBusy && (
        <WorkingState
          className="mt-3 max-w-md"
          label={videoProgress}
          messages={VIDEO_GEN_MESSAGES}
          progress={null}
        />
      )}
      {filmStage && (
        <WorkingState
          className="mt-3 max-w-md"
          label={filmStage}
          messages={FILM_GEN_MESSAGES}
          progress={filmProgress}
          startedAt={filmStartedAt}
        />
      )}
      {filmError && <p className="mt-2 text-xs text-danger">{filmError}</p>}
      {filmAsset && (
        <div className="mt-4">
          <video src={filmAsset.url} controls playsInline className="max-h-96 rounded-xl border border-border" />
          <p className="mt-1 text-xs text-faint">
            The final cut — segments stitched, narrated and captioned. Saved to the{" "}
            <Link href="/media" className="text-accent underline">Media library</Link>.
          </p>
        </div>
      )}
      {videoError && <p className="mt-2 text-xs text-danger">{videoError}</p>}
      {draftError && <p className="mt-2 text-xs text-danger">{draftError}</p>}
      {draftDone && (
        <p className="mt-2 text-xs text-success">
          Draft created — review it in the <Link href="/calendar" className="text-accent underline">Calendar</Link>.
        </p>
      )}

      {imageAsset && (
        <div className="mt-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- local authenticated stream, not optimizable */}
          <img src={imageAsset.url} alt={assetTitle} className="max-h-96 rounded-xl border border-border" />
          <p className="mt-1 text-xs text-faint">
            Saved to the <Link href="/media" className="text-accent underline">Media library</Link>.
          </p>
          {/* Refine: your note edits THIS image — each pass is also kept in the library. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={imageRefine}
              onChange={(e) => setImageRefine(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !imageBusy && refineImage()}
              placeholder="Refine it — e.g. 'warmer light, add negative space top-left for a headline'"
              className="input min-w-64 flex-1 text-xs"
            />
            <button onClick={refineImage} disabled={imageBusy || !imageRefine.trim()} className="btn btn-secondary text-xs">
              {imageBusy ? "Refining…" : "✨ Refine image"}
            </button>
          </div>
          {imageNotes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-faint">
              {imageNotes.map((n, i) => (
                <li key={i}>✓ {n}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-faint">
            Happy with it? <span className="text-foreground">📅 Draft in Calendar</span> above attaches this
            creative to a post you can schedule and approve.
          </p>
        </div>
      )}

      {videoAsset && (
        <div className="mt-4">
          <video controls src={videoAsset.url} className="max-h-96 rounded-xl border border-border" />
          <p className="mt-1 text-xs text-faint">
            Saved to the <Link href="/media" className="text-accent underline">Media library</Link>.
          </p>
          {/* Videos can't be edited in place — a refine re-shoots with your note. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={videoRefine}
              onChange={(e) => setVideoRefine(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !videoBusy && refineVideo()}
              placeholder="Refine it — e.g. 'slower camera move, end on the logo wall'"
              className="input min-w-64 flex-1 text-xs"
            />
            <button onClick={refineVideo} disabled={videoBusy || !videoRefine.trim()} className="btn btn-secondary text-xs">
              {videoBusy ? "Re-shooting…" : "✨ Re-shoot with note"}
            </button>
          </div>
          {videoNotes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-faint">
              {videoNotes.map((n, i) => (
                <li key={i}>✓ {n}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-faint">
            Happy with it? <span className="text-foreground">📅 Draft in Calendar</span> above attaches this
            creative to a post you can schedule and approve.
          </p>
        </div>
      )}
    </div>
  );
}
