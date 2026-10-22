"use client";

import { useSyncExternalStore } from "react";

/**
 * The wall clock as an external store, for components that compare dates
 * against "now" while rendering ("arrived overnight?", "is this still ahead?")
 * without calling the impure Date.now() mid-render.
 *
 * Coarse on purpose — ticks once a minute, shared by every subscriber. It is
 * not a stopwatch; use `useElapsed` for those.
 *
 * Returns `null` on the server and during hydration (the server cannot know
 * the viewer's clock), then the real time right after hydrate — callers treat
 * `null` as "unknown yet" rather than as 0.
 */
const TICK_MS = 60_000;
const listeners = new Set<() => void>();
let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  if (now === 0) now = Date.now();
  return now;
}

function getServerSnapshot(): null {
  return null;
}

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
