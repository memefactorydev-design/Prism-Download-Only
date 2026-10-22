"use client";

import { useEffect, useState } from "react";
import { useElapsed } from "@/lib/hooks/useElapsed";

/* ─── Prism loading system ───────────────────────────────────────────────────
   Keeps people engaged while the engine works: a spectrum spinner, skeleton
   shimmers, and a WorkingState that narrates the stage, counts the wait, and
   moves a light along the bar. All motion respects prefers-reduced-motion via
   globals.css. Brand: obsidian + the indigo→amber spectrum, spent sparingly. */

type SpinnerSize = "sm" | "md" | "lg";
const SPINNER_PX: Record<SpinnerSize, number> = { sm: 16, md: 22, lg: 34 };

/** A spectrum conic ring that spins — the app's single spinner.
 *  Set `decorative` when a parent (e.g. WorkingState) already announces the
 *  wait, so screen readers don't hear "Loading" twice. */
export function Spinner({
  size = "md",
  decorative = false,
  className = "",
}: {
  size?: SpinnerSize;
  decorative?: boolean;
  className?: string;
}) {
  const px = SPINNER_PX[size];
  return (
    <span
      className={`prism-spinner ${className}`}
      style={{ width: px, height: px }}
      {...(decorative ? { "aria-hidden": true } : { role: "status", "aria-label": "Loading" })}
    />
  );
}

/** A single shimmer block. Give it width/height via className. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** A stack of shimmer lines, last one short — the Blaze "text loading" look. */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  const widths = ["100%", "96%", "88%", "92%", "70%"];
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-3.5"
          style={{ width: i === lines - 1 ? "55%" : widths[i % widths.length] }}
        />
      ))}
    </div>
  );
}

/** Three dots that fill in sequence — a live "…" that reads as active work. */
export function LoadingDots({ className = "" }: { className?: string }) {
  return (
    <span className={`prism-dots ${className}`} aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

/** The spectrum progress track — determinate fill or an indeterminate sweep. */
export function ProgressBar({ progress, className = "" }: { progress?: number | null; className?: string }) {
  const determinate = typeof progress === "number" && Number.isFinite(progress);
  return (
    <div
      className={`prism-progress ${className}`}
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(progress!) : undefined}
    >
      {determinate ? (
        <div
          className="prism-progress-fill"
          style={{ width: `${Math.min(100, Math.max(2, progress!))}%` }}
        />
      ) : (
        <div className="prism-progress-indeterminate" />
      )}
    </div>
  );
}

export interface WorkingStateProps {
  /** A fixed status line (e.g. a server-provided job stage). Wins over `messages`. */
  label?: string | null;
  /** Narration lines played IN ORDER while there's no server stage; once the
   *  story is told, the last two alternate so the surface never loops back to
   *  "warming up" mid-render (and never freezes either). */
  messages?: string[];
  /** Epoch ms the work began (e.g. job.createdAt) — enables a true elapsed clock. */
  startedAt?: number;
  /** Determinate progress 0–100; omit for an indeterminate spectrum sweep. */
  progress?: number | null;
  /** Show the m:ss elapsed counter (default true). */
  timer?: boolean;
  /** "card" = bordered padded panel; "inline" = a compact row (+ bar when determinate). */
  variant?: "card" | "inline";
  className?: string;
}

/**
 * The waiting hero. Narrates what's happening (stage or sequenced messages),
 * counts how long it's taken, and animates a spectrum progress bar — so a slow
 * render or agent run feels alive instead of frozen.
 */
export function WorkingState({
  label,
  messages,
  startedAt,
  progress,
  timer = true,
  variant = "card",
  className = "",
}: WorkingStateProps) {
  const [idx, setIdx] = useState(0);
  const rotate = !label && !!messages && messages.length > 1;
  // Depend on content, not array identity — boards often pass inline arrays,
  // and a parent re-render must not reset the narration.
  const msgKey = messages?.join("\n") ?? "";
  // A new story (or rotation switching on/off) restarts the narration from
  // its first line — derived during render so the reset paints immediately.
  const storyKey = rotate ? msgKey : "";
  const [prevStoryKey, setPrevStoryKey] = useState(storyKey);
  if (prevStoryKey !== storyKey) {
    setPrevStoryKey(storyKey);
    setIdx(0);
  }

  useEffect(() => {
    if (!rotate) return;
    const count = msgKey.split("\n").length;
    let step = 0;
    const id = setInterval(() => {
      step += 1;
      // Advance through the story once, then alternate the final two lines.
      setIdx(step < count ? step : count - 2 + (step % 2));
    }, 3200);
    return () => clearInterval(id);
  }, [rotate, msgKey]);

  const elapsed = useElapsed(true, startedAt);
  const line = label ?? (messages && messages.length ? messages[Math.min(idx, messages.length - 1)] : "Working");
  const determinate = typeof progress === "number" && Number.isFinite(progress);

  // Screen readers hear the meaningful stage (or a calm "Working…") — not the
  // rotating reassurance lines, which would re-announce every few seconds.
  const announcer = (
    <span role="status" className="sr-only">
      {label ?? "Working…"}
    </span>
  );

  if (variant === "inline") {
    return (
      <div className={`min-w-0 ${className}`}>
        {announcer}
        <div className="flex items-center gap-2.5 text-xs text-muted">
          <Spinner size="sm" decorative />
          {/* key re-runs the fade so each new line resolves in place. */}
          <span key={line} className="prism-status-line min-w-0 truncate" aria-hidden>
            {line}
          </span>
          <LoadingDots />
          {timer && <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">{elapsed}</span>}
        </div>
        {determinate && <ProgressBar progress={progress} className="mt-2" />}
      </div>
    );
  }

  return (
    <div className={`prism-working card p-4 ${className}`}>
      {announcer}
      <div className="flex items-center gap-3">
        <Spinner size="md" decorative />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-medium text-foreground" aria-hidden>
            <span key={line} className="prism-status-line min-w-0 truncate">
              {line}
            </span>
            <LoadingDots />
          </p>
        </div>
        {timer && (
          <span className="shrink-0 rounded-md bg-foreground/5 px-2 py-0.5 font-mono text-[11px] text-faint tabular-nums">
            {elapsed}
          </span>
        )}
      </div>
      <div className="mt-3">
        <ProgressBar progress={progress} />
      </div>
    </div>
  );
}
