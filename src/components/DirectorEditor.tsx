"use client";

// The Director editor: left = chat with the director agent; right = preview
// player + revisions + the storyboard rendered from the working FablePlan.
// Single poll target (GET /api/fable/[id]) refreshes everything while work is
// in flight. Mirrors the site builder's optimistic-chat pattern.

import { GenerateVisual } from "@/components/ui/GenerateVisual";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WorkingState } from "@/components/ui/Loading";

const DIRECTOR_THINKING = [
  "Reading your note…",
  "Re-planning the cut…",
  "Choosing shots and pacing…",
  "Timing the captions…",
];
const DIRECTOR_RENDER = [
  "Setting up the render…",
  "Laying down your clips…",
  "Burning in captions…",
  "Mixing the audio…",
  "Encoding the final file…",
];

interface SceneDTO {
  sourceIndex: number;
  startMs: number;
  endMs: number;
  effect: string;
  audio: string;
  captionNote: string;
  speed?: number;
  transition?: string;
}
interface PlanDTO {
  title: string;
  hook: string;
  targetDurationMs: number;
  captions: boolean;
  captionStyle: string;
  keywords: string[];
  emojiHints: { word: string; emoji: string }[];
  scenes: SceneDTO[];
  music: { mode: string; query: string; assetId: string; beatSync: boolean; beatCadence: number };
  voiceover: { enabled: boolean; script: string; voiceId: string };
  sfxIntensity: string;
}
interface SourceDTO {
  index: number;
  name: string;
  durationSecs: number | null;
  hasAudio: boolean;
  status: string;
}
interface MessageDTO {
  id: string;
  role: string;
  content: string;
  hasSnapshot: boolean;
  createdAt: string;
}
interface RevisionDTO {
  id: string;
  number: number;
  quality: string;
  createdAt: string;
  job: { status: string; stage: string | null; progress: number; errorMessage: string | null } | null;
  clipAssetId: string | null;
  clipId: string | null;
}
interface ProjectDTO {
  id: string;
  title: string;
  status: string;
  errorMessage: string | null;
  plan: PlanDTO | null;
  planVersion: number;
  sources: SourceDTO[];
  messages: MessageDTO[];
  revisions: RevisionDTO[];
}

const ACTIVE_JOB = ["queued", "probing", "transcribing", "planning", "rendering"];
const POST_CHANNELS = ["instagram", "tiktok", "youtube", "facebook", "linkedin", "pinterest"];

export function DirectorEditor({ projectId, initialTitle }: { projectId: string; initialTitle: string }) {
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [draftMsgs, setDraftMsgs] = useState<{ id: string; role: string; content: string }[]>([]);
  // Studio hands footage over with a first instruction in ?say= — prefill it.
  const [input, setInput] = useState(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("say") ?? "" : ""
  );
  const [chatBusy, setChatBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [selectedRev, setSelectedRev] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderedPlanVersion, setRenderedPlanVersion] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/fable/${projectId}`);
    if (!res.ok) return;
    const body = (await res.json()) as ProjectDTO;
    setProject(body);
  }, [projectId]);

  useEffect(() => {
    const t = setTimeout(load, 0); // initial fetch (async — state lands via callback)
    return () => clearTimeout(t);
  }, [load]);

  // Poll while preparing or any render job is active.
  const anyActive =
    project?.status === "preparing" ||
    project?.revisions.some((r) => r.job && ACTIVE_JOB.includes(r.job.status)) ||
    false;
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [anyActive, load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [project?.messages.length, draftMsgs.length, chatBusy]);

  const messages = [...(project?.messages ?? []), ...draftMsgs.map((m) => ({ ...m, hasSnapshot: false, createdAt: "" }))];
  const revisions = project?.revisions ?? [];
  const currentRev = revisions.find((r) => r.id === selectedRev) ?? revisions[0] ?? null;
  const activeRender = revisions.find((r) => r.job && ACTIVE_JOB.includes(r.job.status)) ?? null;
  const planChanged =
    renderedPlanVersion !== null && project ? project.planVersion > renderedPlanVersion : false;
  const morphCount =
    project?.plan?.scenes.filter((s, i) => i > 0 && s.transition === "morph").length ?? 0;

  async function send() {
    const message = input.trim();
    if (!message || chatBusy || !project) return;
    setInput("");
    setError(null);
    setChatBusy(true);
    setDraftMsgs((d) => [...d, { id: `tmp-${Date.now()}`, role: "user", content: message }]);
    try {
      const res = await fetch(`/api/fable/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(body.error ?? "The Director hit a problem.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftMsgs([]);
      setChatBusy(false);
      load();
    }
  }

  async function render(quality: "draft" | "final") {
    if (!project) return;
    setRenderBusy(true);
    setError(null);
    const res = await fetch(`/api/fable/${projectId}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quality }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setRenderBusy(false);
    if (!res.ok) setError(body.error ?? "Could not start the render.");
    else {
      setRenderedPlanVersion(project.planVersion);
      setSelectedRev(null); // follow the newest
    }
    load();
  }

  async function restore(messageId: string) {
    await fetch(`/api/fable/${projectId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
    load();
  }

  async function sendToCalendar(clipId: string, channel: string) {
    setError(null);
    const res = await fetch(`/api/studio/clips/${clipId}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) setError(body.error ?? "Could not create the draft.");
    else setError(null);
    if (res.ok) alert("Draft created — finish and approve it on the Calendar.");
  }

  const plan = project?.plan ?? null;
  const preparing = project?.status === "preparing";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      {/* Chat */}
      <div className="card flex h-[60vh] min-w-0 flex-col p-0 lg:h-[78vh]">
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs font-semibold text-accent">The Director · Prism Mind</p>
          <h2 className="truncate text-sm font-semibold text-foreground">{project?.title ?? initialTitle}</h2>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {preparing && (
            <p className="text-sm text-muted">
              Reading your footage…{" "}
              {project?.sources.map((s) => `${s.name}: ${s.status}`).join(" · ")}
            </p>
          )}
          {!preparing && messages.length === 0 && (
            <p className="text-sm text-muted">
              Step 2 — describe the video you want. e.g. “Cut a 30-second ad from these walkthroughs:
              urgent voice-over about our spring consultations, punchy music, beast captions, end on a
              call to action.”
            </p>
          )}
          {!preparing && (
            <GenerateVisual
              kind="image"
              askPrompt="Describe a photo to conjure — it becomes a source the Director can animate…"
              label="✨ Conjure a photo source"
              title="Conjured source"
              onCreated={async (asset) => {
                await fetch(`/api/fable/${projectId}/source`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ assetId: asset.id }),
                });
                load();
              }}
            />
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                  m.role === "user" ? "bg-accent-soft text-foreground" : "bg-foreground/5 text-foreground"
                }`}
              >
                {m.content}
                {m.role === "assistant" && m.hasSnapshot && (
                  <button
                    onClick={() => restore(m.id)}
                    className="mt-1 block text-[11px] text-faint underline hover:text-accent"
                    title="Make this turn's plan the working plan again"
                  >
                    Restore this plan
                  </button>
                )}
              </div>
            </div>
          ))}
          {chatBusy && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl bg-foreground/5 px-3.5 py-2.5">
                <WorkingState variant="inline" messages={DIRECTOR_THINKING} timer={false} />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="border-t border-border p-3">
          {error && <p className="mb-2 text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              rows={2}
              disabled={preparing || chatBusy}
              placeholder={preparing ? "Reading your footage…" : "Tell the Director what to make or change…"}
              className="input flex-1 resize-none text-sm"
            />
            <button onClick={send} disabled={preparing || chatBusy || !input.trim()} className="btn btn-primary self-end">
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Preview + storyboard */}
      <div className="min-w-0 space-y-5">
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Step 3 — watch it build</h2>
            <div className="flex items-center gap-2">
              {planChanged && <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">plan changed since last render</span>}
              <button
                onClick={() => render("draft")}
                disabled={!plan || renderBusy || !!activeRender}
                className="btn btn-secondary text-xs"
                title={morphCount ? "Fast 480p preview — morphs shown as free dissolves, nothing billed" : "Fast 480p preview — seconds, not minutes"}
              >
                Create preview
              </button>
              <button
                onClick={() => render("final")}
                disabled={!plan || renderBusy || !!activeRender}
                className="btn btn-primary text-xs"
                title={morphCount ? `Full-quality 1080x1920 render — generates ${morphCount} AI morph bridge${morphCount > 1 ? "s" : ""} (≈$${morphCount})` : "Full-quality 1080x1920 render"}
              >
                Finalise (1080p)
              </button>
            </div>
          </div>

          {revisions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {revisions.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRev(r.id)}
                  className={`badge ${
                    currentRev?.id === r.id ? "bg-accent-soft text-accent" : "bg-foreground/8 text-muted"
                  }`}
                >
                  Rev {r.number} · {r.quality}
                  {r.job?.status === "failed" ? " ✗" : r.clipAssetId ? "" : " …"}
                </button>
              ))}
            </div>
          )}

          <div className="mt-4">
            {activeRender && currentRev?.id === activeRender.id ? (
              <WorkingState
                label={activeRender.job?.stage}
                messages={DIRECTOR_RENDER}
                progress={(activeRender.job?.progress ?? 0) > 0 ? activeRender.job?.progress : null}
                startedAt={Date.parse(activeRender.createdAt) || undefined}
              />
            ) : currentRev?.clipAssetId ? (
              <div className="flex min-w-0 flex-wrap items-start gap-4">
                <video
                  key={currentRev.clipAssetId}
                  src={`/api/media/${currentRev.clipAssetId}/file`}
                  controls
                  className="h-auto max-h-[52vh] w-auto max-w-full rounded-xl border border-border"
                />
                <div className="space-y-2">
                  <p className="text-xs text-muted">
                    Rev {currentRev.number} · {currentRev.quality === "draft" ? "480p preview" : "1080p final"}
                  </p>
                  {currentRev.clipId && (
                    <div className="flex items-center gap-2">
                      <select id={`ch-${currentRev.id}`} className="input w-auto py-1.5 text-xs" defaultValue="instagram">
                        {POST_CHANNELS.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          const sel = document.getElementById(`ch-${currentRev.id}`) as HTMLSelectElement;
                          sendToCalendar(currentRev.clipId!, sel.value);
                        }}
                        className="btn btn-secondary text-xs"
                      >
                        Send to Calendar
                      </button>
                    </div>
                  )}
                  <a
                    href={`/api/media/${currentRev.clipAssetId}/file`}
                    download
                    className="block text-xs text-accent underline"
                  >
                    Download
                  </a>
                </div>
              </div>
            ) : currentRev?.job?.status === "failed" ? (
              <p className="text-sm text-danger">Render failed: {currentRev.job.errorMessage}</p>
            ) : (
              <p className="text-sm text-muted">
                No renders yet — once the Director has a plan, hit <span className="font-medium">Create preview</span>.
              </p>
            )}
          </div>
        </div>

        {/* Storyboard */}
        {plan && (
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Storyboard — {plan.title}</h2>
              <span className="text-xs text-faint">{(plan.scenes.reduce((a, s) => a + s.endMs - s.startMs, 0) / 1000).toFixed(1)}s</span>
            </div>
            <p className="mt-1 text-xs text-muted">Hook: “{plan.hook}”</p>

            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              <span className="badge bg-foreground/8 text-muted">captions: {plan.captions ? plan.captionStyle : "off"}</span>
              <span className="badge bg-foreground/8 text-muted">
                music: {plan.music.mode === "none" ? "none" : plan.music.mode === "search" ? `“${plan.music.query}”` : "picked track"}
                {plan.music.beatSync ? " · beat-synced" : ""}
              </span>
              <span className="badge bg-foreground/8 text-muted">
                voice-over: {plan.voiceover.enabled ? "on" : "off"}
              </span>
              <span className="badge bg-foreground/8 text-muted">SFX: {plan.sfxIntensity}</span>
              {plan.emojiHints.map((h) => (
                <span key={h.word} className="badge bg-foreground/8 text-muted">{h.emoji} on “{h.word}”</span>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              {plan.scenes.map((s, i) => {
                const src = project?.sources.find((x) => x.index === s.sourceIndex);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2 text-xs">
                    <span className="badge bg-accent-soft text-accent shrink-0">{i + 1}</span>
                    <span className="max-w-40 truncate text-muted" title={src?.name}>{src?.name ?? `source ${s.sourceIndex}`}</span>
                    <span className="font-mono text-faint">
                      {(s.startMs / 1000).toFixed(1)}–{(s.endMs / 1000).toFixed(1)}s
                    </span>
                    {s.effect !== "none" && <span className="badge bg-foreground/8 text-muted">{s.effect}</span>}
                    {(s.speed ?? 1) !== 1 && (
                      <span className="badge bg-accent-soft text-accent">{s.speed}x {(s.speed ?? 1) < 1 ? "slow-mo" : "speed-up"}</span>
                    )}
                    {i > 0 && s.transition && s.transition !== "cut" && (
                      <span
                        className="badge bg-foreground/8 text-muted"
                        title={s.transition === "morph" ? "AI-generated bridge on the final render (~$1); drafts preview it as a dissolve" : "free crossfade"}
                      >
                        ⇢ {s.transition}{s.transition === "morph" ? " · ~$1" : ""}
                      </span>
                    )}
                    <span title={s.audio === "mute" ? "muted" : "keeps its sound"}>{s.audio === "mute" ? "🔇" : "🎙"}</span>
                    {s.captionNote && <span className="min-w-0 flex-1 basis-32 truncate text-faint">{s.captionNote}</span>}
                  </div>
                );
              })}
            </div>

            {plan.voiceover.enabled && (
              <details className="mt-3 rounded-xl border border-border p-3">
                <summary className="cursor-pointer text-xs font-medium text-foreground">Narration script</summary>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{plan.voiceover.script}</p>
              </details>
            )}
          </div>
        )}

        {project?.status === "failed" && (
          <div className="card border-red-300 p-5">
            <p className="text-sm text-danger">Project failed: {project.errorMessage}</p>
            <p className="mt-1 text-xs text-muted">
              Fix the footage on the <Link href="/media" className="underline">Media page</Link> and create a new project.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
