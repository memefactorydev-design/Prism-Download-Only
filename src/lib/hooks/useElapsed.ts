"use client";

import { useEffect, useRef, useState } from "react";

/** Format a millisecond span as m:ss (or h:mm:ss past an hour). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * A live `m:ss` string that ticks every second while `active` is true — the
 * "how long have I been waiting" counter behind every waiting surface.
 *
 * Pass `startedAt` (epoch ms, e.g. a job's createdAt) to survive remounts and
 * show true elapsed time; omit it to count from the moment the wait began.
 *
 * SSR-safe: renders "0:00" on the server and snaps to the true elapsed value
 * on mount, so a job that's already mid-render never causes a hydration
 * mismatch (Date.now() differs between server and client).
 */
export function useElapsed(active: boolean, startedAt?: number): string {
  const [label, setLabel] = useState("0:00");
  const [wasActive, setWasActive] = useState(active);
  const originRef = useRef<number | null>(null);

  // A wait starting or ending resets the clock. Done during render (React's
  // "adjusting state when a prop changes" pattern) rather than in the effect,
  // so a stale reading from the previous wait is never painted.
  if (wasActive !== active) {
    setWasActive(active);
    setLabel("0:00");
  }

  useEffect(() => {
    if (!active) {
      originRef.current = null;
      return;
    }
    if (startedAt != null) originRef.current = startedAt;
    else if (originRef.current == null) originRef.current = Date.now();
    const origin = originRef.current;
    const update = () => setLabel(formatElapsed(Date.now() - origin));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);

  return label;
}
