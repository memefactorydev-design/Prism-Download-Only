"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { GenerateVisual } from "@/components/ui/GenerateVisual";
import { useCallback, useEffect, useRef, useState } from "react";
import { CAPTION_STYLES, DEFAULT_CAPTION_STYLE } from "@/lib/video/caption-styles";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { IconUpload, IconDownload, IconSend, IconFlame } from "@/components/ui/icons";
import { MusicPicker, type MusicChoice } from "@/components/MusicPicker";
import { WorkingState } from "@/components/ui/Loading";

// Reassuring stage narration shown while a render is queued but the worker
// hasn't reported a stage yet — keeps a fresh job from looking frozen.
const STUDIO_WAIT_MESSAGES = [
  "Warming up the render engine…",
  "Studying your footage…",
  "Finding the strongest moments…",
  "Writing hooks and captions…",
  "Cutting your clips…",
];

export interface ClipDTO {
  id: string;
  kind: string;
  rank: number;
  title: string;
  hook: string;
  caption: string | null;
  status: string;
  assetId: string | null;
  errorMessage: string | null;
  viralityScore: number | null;
  viralityRationale: string | null;
}
export interface JobDTO {
  id: string;
  status: string;
  stage: string | null;
  progress: number;
  outputKinds: string;
  mode: string;
  errorMessage: string | null;
  createdAt: string;
  sourceName: string | null;
  sourceAssetId?: string;
  clips: ClipDTO[];
}

const TERMINAL = ["complete", "partial", "failed"];
const CHANNELS = ["instagram", "facebook", "tiktok", "linkedin", "youtube", "pinterest"] as const;

export interface TemplateOption {
  id: string;
  title: string;
}

export interface TrendChip {
  id: string;
  title: string;
  platform: string;
}

export function StudioBoard({
  initialJobs,
  templates = [],
  trendChips = [],
  falEnabled = false,
}: {
  initialJobs: JobDTO[];
  templates?: TemplateOption[];
  trendChips?: TrendChip[];
  falEnabled?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  // Preselect a template if the user arrived via "Use in Studio" (?template=<id>).
  const initialTemplate = searchParams.get("template") ?? "";
  const [templateId, setTemplateId] = useState(
    templates.some((t) => t.id === initialTemplate) ? initialTemplate : ""
  );
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [captionStyle, setCaptionStyle] = useState(DEFAULT_CAPTION_STYLE);
  const [tightEdit, setTightEdit] = useState(false);
  const [trackSpeaker, setTrackSpeaker] = useState(false);
  const [mode, setMode] = useState<"single" | "mix" | "voiceover">("single");
  const mixMode = mode === "mix";
  const voMode = mode === "voiceover";
  const [voBrief, setVoBrief] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [voEnabled, setVoEnabled] = useState<boolean | null>(null);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [effectsOn, setEffectsOn] = useState(true);
  const [sfxOn, setSfxOn] = useState(true);
  const [music, setMusic] = useState<MusicChoice>(null);
  const [beatSync, setBeatSync] = useState(false);
  const [morphsOn, setMorphsOn] = useState(false);
  const [beatCadence, setBeatCadence] = useState(2);
  const [live, setLive] = useState<Record<string, JobDTO>>({});
  // Upload-first golden path: the drawer holds every secondary decision and
  // stays shut until asked for — smart defaults carry the first render.
  const [showAdjust, setShowAdjust] = useState(false);
  const [trendId, setTrendId] = useState("");
  const busy = uploadLabel !== null || uploadPct !== null;

  const jobs = initialJobs.map((j) => live[j.id] ?? j);
  for (const id of Object.keys(live)) {
    if (!initialJobs.some((j) => j.id === id)) jobs.unshift(live[id]);
  }

  const poll = useCallback(
    async (jobId: string) => {
      const res = await fetch(`/api/studio/jobs/${jobId}`);
      if (!res.ok) return;
      const view = (await res.json()) as {
        job: Omit<JobDTO, "sourceName" | "clips">;
        source: { originalName: string } | null;
        clips: ClipDTO[];
      };
      const dto: JobDTO = { ...view.job, sourceName: view.source?.originalName ?? null, clips: view.clips };
      setLive((m) => ({ ...m, [jobId]: dto }));
      if (TERMINAL.includes(dto.status)) router.refresh();
    },
    [router]
  );

  useEffect(() => {
    const active = jobs.filter((j) => !TERMINAL.includes(j.status)).map((j) => j.id);
    if (!active.length) return;
    const t = setInterval(() => active.forEach(poll), 2500);
    return () => clearInterval(t);
  }, [jobs, poll]);

  // Load the ElevenLabs voice list the first time voice-over mode is opened.
  useEffect(() => {
    if (!voMode || voEnabled !== null) return;
    fetch("/api/studio/voices")
      .then((r) => r.json())
      .then((b: { enabled?: boolean; voices?: { id: string; name: string }[]; defaultVoiceId?: string | null }) => {
        setVoEnabled(Boolean(b.enabled));
        setVoices(b.voices ?? []);
        if (b.defaultVoiceId) setVoiceId(b.defaultVoiceId);
      })
      .catch(() => setVoEnabled(false));
  }, [voMode, voEnabled]);

  function seedJob(jobId: string, sourceName: string, mode = "single") {
    setLive((m) => ({
      ...m,
      [jobId]: {
        id: jobId, status: "queued", stage: "Queued", progress: 0, outputKinds: "reel",
        mode, errorMessage: null, createdAt: new Date().toISOString(), sourceName, clips: [],
      },
    }));
    poll(jobId);
  }

  function uploadOne(
    file: File,
    purpose: "single" | "stage" | "music",
    musicAssetId?: string
  ): Promise<{ jobId?: string; assetId?: string }> {
    return new Promise((resolve, reject) => {
      const musicParam = musicAssetId ? `&musicAssetId=${encodeURIComponent(musicAssetId)}` : "";
      const query =
        purpose === "music"
          ? "?kind=music"
          : purpose === "stage"
            ? "?defer=1"
            : voMode
              ? `?mode=voiceover&captionStyle=${encodeURIComponent(captionStyle)}` +
                `&captions=${captionsOn ? "1" : "0"}` +
                `&voBrief=${encodeURIComponent(voBrief.slice(0, 1500))}` +
                (voiceId ? `&voiceId=${encodeURIComponent(voiceId)}` : "") +
                musicParam
              : `?kinds=reel&captionStyle=${encodeURIComponent(captionStyle)}` +
                `&tightEdit=${tightEdit ? "1" : "0"}&reframe=${trackSpeaker ? "track" : "center"}` +
                `&captions=${captionsOn ? "1" : "0"}` +
                `&effects=${effectsOn ? "1" : "0"}&sfx=${sfxOn ? "1" : "0"}` +
                (templateId ? `&templateId=${encodeURIComponent(templateId)}` : "") +
                (trendId && !templateId ? `&trendId=${encodeURIComponent(trendId)}` : "") +
                musicParam;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/studio/upload${query}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let body: { jobId?: string; assetId?: string; error?: string } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error ?? `Upload failed (HTTP ${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error("Upload failed to reach the server — is the dev server running?"));
      xhr.send(file);
    });
  }

  async function handleFiles(files: File[]) {
    const vids = files.filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(f.name));
    if (!vids.length) return;
    setError(null);
    try {
      if (mixMode) {
        if (vids.length < 2) {
          setError("Pick at least 2 videos to mix into a montage.");
          return;
        }
        const assetIds: string[] = [];
        for (let i = 0; i < vids.length; i++) {
          setUploadLabel(`Uploading ${i + 1}/${vids.length}`);
          setUploadPct(0);
          const r = await uploadOne(vids[i], "stage");
          if (r.assetId) assetIds.push(r.assetId);
        }
        let musicAssetId: string | undefined;
        if (music?.kind === "library") {
          musicAssetId = music.assetId; // already downloaded to a MediaAsset
        } else if (music?.kind === "upload") {
          setUploadLabel("Uploading music");
          setUploadPct(0);
          musicAssetId = (await uploadOne(music.file, "music")).assetId;
        }
        setUploadLabel("Creating montage…");
        const res = await fetch("/api/studio/montage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetIds,
            captionStyle,
            captions: captionsOn,
            musicAssetId,
            beatSync: beatSync && !!musicAssetId,
            beatCadence,
            morphs: morphsOn && falEnabled,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
        if (res.ok && body.jobId) seedJob(body.jobId, `Montage of ${vids.length} videos`, "montage");
        else setError(body.error ?? "Could not create the montage.");
      } else {
        // Optional music bed for single/voice-over jobs — resolve it first.
        let musicAssetId: string | undefined;
        if (music?.kind === "library") {
          musicAssetId = music.assetId;
        } else if (music?.kind === "upload") {
          setUploadLabel("Uploading music");
          setUploadPct(0);
          musicAssetId = (await uploadOne(music.file, "music")).assetId;
        }
        for (let i = 0; i < vids.length; i++) {
          setUploadLabel(vids.length > 1 ? `Uploading ${i + 1}/${vids.length}` : null);
          setUploadPct(0);
          const r = await uploadOne(vids[i], "single", musicAssetId);
          if (r.jobId) seedJob(r.jobId, vids[i].name, voMode ? "voiceover" : "single");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadPct(null);
      setUploadLabel(null);
    }
  }

  const settingsSummary = [
    captionsOn ? `${CAPTION_STYLES.find((c) => c.id === captionStyle)?.label ?? "Bold"} captions` : "no captions",
    effectsOn && !voMode ? "effects on" : null,
    music ? "music bed" : null,
    templateId ? "template applied" : trendId ? "trend pattern applied" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      {/* Golden path: the drop IS the interface. One slim row of real choices,
          everything else defaulted and tucked in the Adjust drawer. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={mode}
          onChange={(v) => {
            const next = v as "single" | "mix" | "voiceover";
            setMode(next);
            // Voice-over needs its brief, which lives in the drawer — open it.
            if (next === "voiceover") setShowAdjust(true);
          }}
          options={[
            { value: "single", label: "Clip videos" },
            { value: "mix", label: "Mix montage" },
            { value: "voiceover", label: "Voice-over" },
          ]}
        />
        <button
          type="button"
          onClick={() => setShowAdjust((v) => !v)}
          className="btn btn-secondary text-xs"
        >
          {showAdjust ? "Hide adjustments ▴" : "Adjust ▾"}
        </button>
      </div>

      {/* Dropzone — the hero. */}
      <button
        type="button"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center sm:p-12 transition-all ${
          dragging
            ? "border-accent bg-accent-soft shadow-glow"
            : "border-border-strong hover:border-accent hover:bg-accent-soft/40 hover:shadow-glow"
        }`}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-accent text-white shadow-glow">
          <IconUpload className="h-6 w-6" />
        </span>
        <p className="mt-4 text-base font-medium text-foreground">
          {busy
            ? `${uploadLabel ?? "Uploading"}${uploadPct !== null ? ` · ${uploadPct}%` : "…"}`
            : mixMode
              ? "Drop 2+ videos to mix into one montage"
              : "Drop videos to cut into viral reels"}
        </p>
        <p className="mt-1 text-sm text-muted">
          MP4, MOV or WebM — {mixMode ? "the AI mixes the best moments across them" : "the AI finds the best moments"}
        </p>
        {busy && uploadPct !== null && (
          <div className="mt-4 h-1 w-56 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </button>
      <p className="mt-2 text-xs text-faint">
        Smart defaults: {settingsSummary}. Renders run in the background — keep working or drop another video.
      </p>
      <div className="mt-3">
        <GenerateVisual
          kind="video"
          askPrompt="No footage handy? Describe AI b-roll to generate — it lands in your library, ready to cut…"
          label="🎬 Generate AI b-roll"
          title="AI b-roll"
          onCreated={() => router.refresh()}
        />
      </div>

      {/* What's winning right now — tap a pattern and the cut follows it. */}
      {mode === "single" && trendChips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted">Cut it like what&rsquo;s winning:</span>
          {trendChips.slice(0, 6).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTrendId((cur) => (cur === t.id ? "" : t.id));
                setTemplateId("");
              }}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                trendId === t.id
                  ? "border-accent bg-accent-soft text-foreground"
                  : "border-border text-muted hover:border-accent hover:text-foreground"
              }`}
              title={`${t.platform} trend — the reel plan follows this pattern`}
            >
              {trendId === t.id ? "✓ " : ""}{t.title.length > 44 ? `${t.title.slice(0, 44)}…` : t.title}
            </button>
          ))}
        </div>
      )}

      {/* The Adjust drawer — every secondary decision lives here. */}
      {showAdjust && (
      <div className="card mt-4 flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            Captions
            <select
              value={captionStyle}
              onChange={(e) => setCaptionStyle(e.target.value)}
              disabled={!captionsOn}
              className="input w-auto py-1.5 disabled:opacity-40"
            >
              {CAPTION_STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {voMode && (
          <div className="space-y-3 border-t border-border pt-4">
            {voEnabled === false && (
              <p className="text-sm text-amber-500">
                Prism Voice isn&apos;t connected yet — set it up on the Connections page to
                enable narration. Uploads will fail loudly until then.
              </p>
            )}
            <label className="block text-sm text-muted">
              <span className="mb-1 block">What should the narration say?</span>
              <textarea
                value={voBrief}
                onChange={(e) => setVoBrief(e.target.value)}
                rows={3}
                maxLength={1500}
                placeholder="e.g. Walk viewers through this project from first sketch to finished result — the details that matter — and invite them to book a consultation."
                className="input w-full"
              />
            </label>
            <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
              Voice
              <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className="input w-auto py-1.5">
                <option value="">Default narrator</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-faint">
                We write a script sized to your footage, a studio-grade voice reads it, and captions sync
                to the narration word-for-word.
              </span>
            </label>
          </div>
        )}

        {mode === "single" && templates.length > 0 && (
          <label className="flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm text-muted">
            Template
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="input w-auto py-1.5"
            >
              <option value="">None — free edit</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <span className="text-xs text-faint">
              {templateId ? "The reel plan will follow this template's blueprint." : "Pick a viral template blueprint to guide the cut."}
            </span>
          </label>
        )}

        <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
          <Switch checked={captionsOn} onChange={setCaptionsOn} label="Burn captions" hint="Off = clean cinematic" />
          <Switch
            checked={tightEdit && mode === "single"}
            onChange={setTightEdit}
            disabled={mode !== "single"}
            label="Tight edit"
            hint="Remove filler & pauses"
          />
          <Switch
            checked={trackSpeaker && mode === "single"}
            onChange={setTrackSpeaker}
            disabled={mode !== "single"}
            label="Track speaker"
            hint="Auto-reframe to subject"
          />
          <Switch
            checked={effectsOn && !voMode}
            onChange={setEffectsOn}
            disabled={voMode}
            label="On-screen effects"
            hint="Auto zooms, flashes & slow-mo"
          />
          <Switch
            checked={sfxOn && !voMode}
            onChange={setSfxOn}
            disabled={voMode}
            label="Sound effects"
            hint="Whooshes on cuts (needs Prism Voice)"
          />
          {mixMode && (
            <Switch
              checked={morphsOn && falEnabled}
              onChange={setMorphsOn}
              disabled={!falEnabled}
              label="AI morph transitions"
              hint={falEnabled ? "Prism Motion bridges between shots · ~$1 each, up to 4 per job" : "Needs Prism Motion — see Connections"}
            />
          )}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <MusicPicker value={music} onChange={setMusic} />
          {!mixMode && music && (
            <p className="text-xs text-faint">
              {voMode
                ? "The music sits quietly under the narration."
                : "The music bed ducks automatically whenever someone speaks."}
            </p>
          )}
          {mixMode && music && (
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-56">
                  <Switch checked={beatSync} onChange={setBeatSync} label="Beat sync" hint="Cut on the music's beat" />
                </div>
                {beatSync && (
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Cadence
                    <select
                      value={beatCadence}
                      onChange={(e) => setBeatCadence(Number(e.target.value))}
                      className="input w-auto py-1.5"
                    >
                      <option value={1}>Fast</option>
                      <option value={2}>Punchy</option>
                      <option value={4}>Smooth</option>
                    </select>
                  </label>
                )}
              </div>
            )}
        </div>
      </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {jobs.length === 0 ? (
        <p className="mt-10 text-center text-sm text-faint">
          No reels yet — drop your footage above and the studio does the rest.
        </p>
      ) : (
        <div className="mt-8 flex flex-col gap-5">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job }: { job: JobDTO }) {
  const router = useRouter();
  const [forking, setForking] = useState<string | null>(null);
  const [directorNote, setDirectorNote] = useState("");
  const [directorBusy, setDirectorBusy] = useState(false);

  // P1.4 — hand this footage to the Director with your note as the first cut
  // instruction; the full conversational editor opens ready to go.
  const sendToDirector = async () => {
    if (!job.sourceAssetId || directorBusy) return;
    setDirectorBusy(true);
    const res = await fetch("/api/fable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: job.sourceName ?? "Studio footage", assetIds: [job.sourceAssetId] }),
    });
    const b = (await res.json().catch(() => ({}))) as { id?: string; project?: { id: string }; error?: string };
    setDirectorBusy(false);
    const pid = b.id ?? b.project?.id;
    if (pid) {
      router.push(`/director/${pid}${directorNote.trim() ? `?say=${encodeURIComponent(directorNote.trim())}` : ""}`);
    }
  };
  const settled = TERMINAL.includes(job.status);
  const rendered = job.clips.filter((c) => c.status === "rendered");
  const failedClips = job.clips.filter((c) => c.status === "failed");

  // The failure fork: a dead job always offers a way forward.
  const retry = async (as?: "voiceover") => {
    setForking(as ?? "same");
    await fetch(`/api/studio/jobs/${job.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ as }),
    }).catch(() => {});
    setForking(null);
    router.refresh();
  };

  return (
    <div className="card animate-in p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {job.mode === "montage" && (
            <span className="badge bg-accent-soft text-accent">Montage</span>
          )}
          <p className="truncate text-sm font-medium text-foreground" title={job.sourceName ?? undefined}>
            {job.sourceName ?? "Source video"}
          </p>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {settled ? (
        <p className="mt-1 text-xs text-muted">{job.stage ?? job.status}</p>
      ) : (
        <WorkingState
          variant="inline"
          className="mt-3"
          label={job.stage}
          messages={STUDIO_WAIT_MESSAGES}
          progress={job.progress > 0 ? job.progress : null}
          startedAt={Date.parse(job.createdAt) || undefined}
        />
      )}

      {job.errorMessage && <p className="mt-2 text-xs text-danger">{job.errorMessage}</p>}

      {job.status === "failed" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => retry()} disabled={forking !== null} className="btn btn-secondary text-xs">
            {forking === "same" ? "Restarting…" : "↻ Try again"}
          </button>
          {job.mode !== "voiceover" && job.mode !== "montage" && (
            <button onClick={() => retry("voiceover")} disabled={forking !== null} className="btn btn-secondary text-xs">
              {forking === "voiceover" ? "Starting…" : "🎙 Re-cut with a voice-over"}
            </button>
          )}
        </div>
      )}

      {failedClips.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {failedClips.map((c) => (
            <p key={c.id} className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-1.5 text-xs text-danger">
              “{c.title}” didn&rsquo;t render.
            </p>
          ))}
        </div>
      )}

      {rendered.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {rendered.map((clip) => (
            <ClipCard key={clip.id} clip={clip} />
          ))}
        </div>
      )}

      {settled && job.sourceAssetId && job.mode !== "montage" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input
            value={directorNote}
            onChange={(e) => setDirectorNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendToDirector()}
            placeholder="Want it different? Tell the Director — 'make it punchier, end on the reveal'"
            className="input min-w-0 flex-1 text-xs"
          />
          <button onClick={sendToDirector} disabled={directorBusy} className="btn btn-secondary shrink-0 text-xs">
            {directorBusy ? "Opening…" : "🎬 Edit by chat"}
          </button>
        </div>
      )}
    </div>
  );
}

function ClipCard({ clip }: { clip: ClipDTO }) {
  const [channel, setChannel] = useState<(typeof CHANNELS)[number] | "all">("all");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const src = clip.assetId ? `/api/media/${clip.assetId}/file` : undefined;

  async function sendToPostiz() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/studio/clips/${clip.id}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(channel === "all" ? { refract: true } : { channel }),
    });
    const body = (await res.json().catch(() => ({}))) as { channels?: string[]; error?: string };
    setBusy(false);
    setMsg(
      res.ok
        ? body.channels?.length
          ? `${body.channels.length} native cuts drafted — review them side by side.`
          : "Draft created — finish on Calendar."
        : body.error ?? "Failed."
    );
  }

  const scoreTone =
    clip.viralityScore == null
      ? ""
      : clip.viralityScore >= 80
        ? "bg-emerald-500/90 text-white"
        : clip.viralityScore >= 60
          ? "bg-accent text-accent-foreground"
          : "bg-black/60 text-white";

  return (
    <div className="card-hover group overflow-hidden rounded-2xl border border-border bg-card">
      <div className="relative flex aspect-[9/16] items-center justify-center bg-black">
        {src && <video src={src} className="h-full w-full object-contain" controls playsInline preload="metadata" />}
        <span className="badge absolute left-2 top-2 bg-black/60 text-white">#{clip.rank}</span>
        {clip.viralityScore != null && (
          <span className={`badge absolute right-2 top-2 ${scoreTone}`} title={clip.viralityRationale ?? undefined}>
            <IconFlame className="h-3 w-3" />
            {clip.viralityScore}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-xs font-semibold text-foreground" title={clip.title}>
          {clip.title}
        </p>
        {clip.hook && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{clip.hook}</p>}
        <div className="mt-2.5 flex items-center gap-1.5">
          <a href={src} download={`${clip.title || "reel"}.mp4`} className="btn btn-secondary flex-1 px-2 py-1.5 text-[11px]">
            <IconDownload className="h-3.5 w-3.5" />
            Save
          </a>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number] | "all")}
            className="input w-auto px-1.5 py-1.5 text-[11px]"
            title="Native cuts for every channel by default — pick one channel to opt out"
          >
            <option value="all">All channels ✦</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button onClick={sendToPostiz} disabled={busy} aria-label="Draft in Calendar" title="Draft in Calendar" className="btn btn-primary px-2 py-1.5 text-[11px]">
            <IconSend className="h-3.5 w-3.5" />
          </button>
        </div>
        {msg && <p className="mt-1.5 text-[11px] text-muted">{msg}</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "complete"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : status === "failed"
        ? "bg-danger/15 text-danger"
        : status === "partial"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-accent-soft text-accent";
  return <span className={`badge ${tone}`}>{status}</span>;
}
