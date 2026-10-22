"use client";

// The AI engine card at the top of Connections: which engine is answering,
// what is installed and signed in on this machine, a selector, and a one-line
// live test. Nothing here handles credentials — the CLIs own their sign-ins.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EngineId, EngineMode, EngineOverview, EngineStatus } from "@/lib/llm/types";

interface RateLimit {
  fiveHourUtilization?: number;
  sevenDayUtilization?: number;
  resetsAt?: number;
  seenAt: string;
}

interface TestResult {
  engine: EngineId;
  model?: string;
  text: string;
  ms: number;
}

const MODE_LABEL: Record<EngineMode, string> = {
  auto: "Auto (API key → Claude Code → Codex)",
  "anthropic-api": "Anthropic API key",
  "claude-cli": "Claude Code",
  "codex-cli": "Codex",
};

function Pill({ status }: { status: EngineStatus }) {
  const cls = status.ready
    ? "bg-emerald-500/15 text-emerald-500"
    : status.installed
      ? "bg-amber-500/15 text-amber-500"
      : "border border-border text-faint";
  const text = status.ready ? "Ready" : status.installed ? "Needs sign-in" : "Not installed";
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>;
}

export function EngineCard({
  overview,
  lockedByEnv,
  rateLimit,
  isAdmin,
}: {
  overview: EngineOverview;
  lockedByEnv: boolean;
  rateLimit: RateLimit | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<EngineMode>(overview.mode);
  const [busy, setBusy] = useState<"save" | "test" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [showHow, setShowHow] = useState<EngineId | null>(null);

  const active = overview.engines.find((e) => e.engine === overview.active) ?? null;

  async function save(next: EngineMode) {
    setMode(next);
    setBusy("save");
    setError(null);
    const res = await fetch("/api/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!res.ok) {
      setError(body.error ?? `Failed (HTTP ${res.status}).`);
      setMode(overview.mode);
      return;
    }
    router.refresh();
  }

  async function runTest() {
    setBusy("test");
    setError(null);
    setTest(null);
    const res = await fetch("/api/engine/test", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as TestResult & { error?: string };
    setBusy(null);
    if (!res.ok) {
      setError(body.error ?? `Test failed (HTTP ${res.status}).`);
      return;
    }
    setTest(body);
  }

  async function recheck() {
    setBusy("refresh");
    await fetch("/api/engine?force=1").catch(() => null);
    setBusy(null);
    router.refresh();
  }

  const pct = (v?: number) => (typeof v === "number" ? `${Math.round(v * 100)}%` : null);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-foreground">AI engine</h2>
        <span className={`text-xs ${active ? "text-emerald-500" : "text-amber-500"}`}>
          {active ? `Answering with ${active.label}` : "No engine ready"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Every agent, writer and planner in Prism runs on one engine. Two of them bill a subscription you already
        have — sign in to Claude Code or Codex on this machine and nothing is charged per token. The API key is
        there for anyone who prefers it.
      </p>

      <ul className="mt-4 space-y-3">
        {overview.engines.map((e) => (
          <li key={e.engine} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{e.label}</span>
              <Pill status={e} />
              {e.version && <span className="font-mono text-[11px] text-faint">{e.version}</span>}
              {overview.active === e.engine && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">active</span>
              )}
              {!e.ready && (
                <button
                  onClick={() => setShowHow(showHow === e.engine ? null : e.engine)}
                  className="ml-auto text-xs text-accent underline underline-offset-2"
                >
                  {showHow === e.engine ? "Hide steps" : "How to set up"}
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              {e.detail}
              {e.model && e.ready ? ` Model: ${e.model}.` : ""}
            </p>
            {showHow === e.engine && (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
                {e.howTo.map((step) => (
                  <li key={step}>
                    <code className="rounded bg-background px-1 py-0.5 font-mono text-[11px] text-foreground">{step}</code>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>

      {rateLimit && (pct(rateLimit.fiveHourUtilization) || pct(rateLimit.sevenDayUtilization)) && (
        <p className="mt-3 text-xs text-faint">
          Claude plan usage at last call: 5-hour window {pct(rateLimit.fiveHourUtilization) ?? "–"} · 7-day window{" "}
          {pct(rateLimit.sevenDayUtilization) ?? "–"}
          {rateLimit.resetsAt ? ` · window resets ${new Date(rateLimit.resetsAt * 1000).toLocaleString("en-GB")}` : ""}
        </p>
      )}

      {isAdmin && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-xs text-muted" htmlFor="engine-mode">
            Use
          </label>
          <select
            id="engine-mode"
            className="input max-w-xs text-sm"
            value={mode}
            disabled={lockedByEnv || busy === "save"}
            onChange={(ev) => void save(ev.target.value as EngineMode)}
          >
            {(Object.keys(MODE_LABEL) as EngineMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
          {lockedByEnv && <span className="text-xs text-faint">set by LLM_ENGINE in .env</span>}
          <button onClick={runTest} disabled={busy !== null || !active} className="btn btn-secondary text-xs">
            {busy === "test" ? "Testing…" : "Run a test"}
          </button>
          <button onClick={recheck} disabled={busy !== null} className="text-xs text-muted hover:text-foreground">
            {busy === "refresh" ? "Checking…" : "Re-check"}
          </button>
        </div>
      )}

      {test && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <p className="text-foreground">“{test.text}”</p>
          <p className="mt-1 text-xs text-muted">
            {MODE_LABEL[test.engine]}
            {test.model ? ` · ${test.model}` : ""} · {(test.ms / 1000).toFixed(1)}s
          </p>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <p className="mt-3 text-[11px] text-faint">
        Checked {new Date(overview.checkedAt).toLocaleTimeString("en-GB")}. Subscription engines count every agent run
        against your plan&rsquo;s usage window; nightly dreams are capped so they can&rsquo;t drain it.
      </p>
    </div>
  );
}
