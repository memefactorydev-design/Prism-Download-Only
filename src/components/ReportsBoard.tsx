"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface WeeklyReportItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

export function ReportsBoard({ reports }: { reports: WeeklyReportItem[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    const res = await fetch("/api/reports/weekly", { method: "POST" });
    setRunning(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Report run failed (HTTP ${res.status}).`);
    }
    router.refresh();
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={running}
        className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {running ? "Compiling… (about a minute)" : "Generate weekly report"}
      </button>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {reports.length === 0 ? (
        <p className="mt-8 text-sm text-muted">
          No reports yet. Generate one — the supervisor pulls together the
          week&apos;s content, ad performance, pending approvals, research ideas
          and specialist reports into a single briefing with recommendations.
        </p>
      ) : (
        <div className="mt-8 space-y-4">
          {reports.map((r, i) => (
            <details
              key={r.id}
              open={i === 0}
              className="rounded-2xl border border-border p-5 "
            >
              <summary className="cursor-pointer text-sm font-medium">
                {r.title}
                <span className="ml-2 text-xs font-normal text-muted">
                  {new Date(r.createdAt).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </summary>
              <div className="mt-4 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
                {r.content}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
