"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface SeoReportItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

export function SeoBoard({ reports }: { reports: SeoReportItem[] }) {
  const router = useRouter();
  const [focus, setFocus] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAudit() {
    setRunning(true);
    setError(null);
    const res = await fetch("/api/seo/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ focus: focus || undefined }),
    });
    setRunning(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Audit failed (HTTP ${res.status}).`);
    } else {
      setFocus("");
    }
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="Optional focus, e.g. 'local SEO for Birmingham' "
          className="w-80 rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm "
        />
        <button
          onClick={runAudit}
          disabled={running}
          className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running
            ? "Auditing… (a few minutes — the agent is reading the site and SERPs)"
            : "Run audit"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {reports.length === 0 ? (
        <p className="mt-8 text-sm text-muted">
          No audits yet. Run one — the backend fetches your website (from your brand profile)
          live, and the agent checks UK search results and competitors before
          writing a prioritised fix list. Nothing is changed on the site; every
          fix is tagged [needs approval].
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
