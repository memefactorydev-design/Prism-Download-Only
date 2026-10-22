"use client";

// P4.6 — one honest, dismissible line while no publishing channel is
// connected: everything still generates, nothing goes out yet.

import Link from "next/link";
import { useSyncExternalStore } from "react";

const KEY = "prism_genonly_dismissed";
const listeners = new Set<() => void>();

// The dismissal lives in localStorage, read through useSyncExternalStore: the
// server renders nothing (it can't know), and the client snaps to the stored
// choice as it hydrates — no setState-in-effect round trip.
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function isDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const unknownOnServer = () => true;

function dismiss() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Storage blocked (private mode) — the banner simply returns next visit.
  }
  listeners.forEach((l) => l());
}

export function GenerateOnlyBanner() {
  const hidden = useSyncExternalStore(subscribe, isDismissed, unknownOnServer);
  if (hidden) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm">
      <span className="text-foreground">
        Everything creates fine — but your posts aren&rsquo;t going out yet.{" "}
        <Link href="/connections" className="font-medium text-accent underline underline-offset-2">
          Connect a channel
        </Link>{" "}
        when you&rsquo;re ready to publish.
      </span>
      <button onClick={dismiss} className="ml-auto text-xs text-faint hover:text-foreground">
        Dismiss
      </button>
    </div>
  );
}
