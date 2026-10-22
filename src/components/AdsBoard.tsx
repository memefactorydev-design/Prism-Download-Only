"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WorkingState } from "@/components/ui/Loading";

export interface CampaignRow {
  campaignId: string;
  campaignName: string;
  spend: number;
  revenue: number;
  roas: number | null;
  impressions: number;
  clicks: number;
  roasLast7: number | null;
  roasPrev7: number | null;
}

export interface AdApprovalItem {
  id: string;
  status: string;
  reason: string | null;
  action: string;
  campaignName: string;
  kind: string;
  confidence: string;
  newDailyBudgetGBP: number | null;
  execution: { status: string; message: string } | null;
  createdAt: string;
}

export interface AdsReportItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

const gbp = (n: number) => `£${n.toFixed(2)}`;

export function AdsBoard({
  campaigns,
  approvals,
  latestReport,
  writeState,
  network = "meta",
}: {
  campaigns: CampaignRow[];
  approvals: AdApprovalItem[];
  latestReport: AdsReportItem | null;
  writeState: string | null; // "unlocked" | "pending_app_review"/"blocked" | null (not connected)
  network?: "meta" | "google";
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [capPct, setCapPct] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function analyse(challengerRun = false) {
    setRunning(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/ads/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(challengerRun ? { network, challenger: true, capPct } : { network }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      summary?: { synced: number; approvalsCreated: number };
    };
    setRunning(false);
    if (!res.ok)
      setError(body.error ?? `Analysis failed (HTTP ${res.status}).`);
    else
      setNotice(
        `Synced ${body.summary?.synced} daily rows; ${body.summary?.approvalsCreated} recommendation(s) queued for your approval.`,
      );
    router.refresh();
  }

  async function decide(id: string, decision: "approve" | "reject") {
    setError(null);
    const res = await fetch(`/api/ads/approvals/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Request failed (HTTP ${res.status}).`);
    }
    router.refresh();
  }

  const pending = approvals.filter((a) => a.status === "pending");
  const decided = approvals.filter((a) => a.status !== "pending");

  return (
    <div>
      {writeState && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            writeState === "unlocked"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-400"
          }`}
        >
          {writeState === "unlocked"
            ? "Campaign writes are unlocked. Approved actions execute against the live ad account."
            : network === "google"
              ? "Campaign writes are blocked — usually a developer token without Basic access, or a connection problem. Reading performance and queueing recommendations still works."
              : "Campaign writes are locked pending Meta App Review. Reading performance and queueing recommendations works now; approved actions will say so and wait."}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => analyse()}
          disabled={running}
          className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? "Syncing & analysing… (about a minute)" : "Sync & analyse"}
        </button>
        {/* Champion / challenger: shift up to the cap toward what's winning —
            every move still queues as an approval. */}
        <button
          onClick={() => analyse(true)}
          disabled={running}
          className="rounded-lg border border-border-strong px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          ⚔️ Champion / challenger
        </button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Challenger cap
          <select value={capPct} onChange={(e) => setCapPct(Number(e.target.value))} className="input w-auto py-1 text-xs">
            <option value={5}>5%</option>
            <option value={10}>10%</option>
            <option value={15}>15%</option>
            <option value={20}>20%</option>
          </select>
          of budget
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      {notice && (
        <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
          {notice}
        </p>
      )}

      {running && (
        <WorkingState
          messages={[
            "Syncing your ad spend…",
            "Reading campaign performance…",
            "Comparing spend to won deals…",
            "Writing recommendations…",
          ]}
          progress={null}
          className="mt-4"
        />
      )}

      {campaigns.length > 0 ? (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted ">
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2 text-right">Spend (30d)</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">ROAS</th>
                <th className="px-3 py-2 text-right">Trend (7d)</th>
                <th className="px-3 py-2 text-right">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const trend =
                  c.roasLast7 !== null &&
                  c.roasPrev7 !== null &&
                  c.roasPrev7 !== 0
                    ? ((c.roasLast7 - c.roasPrev7) / c.roasPrev7) * 100
                    : null;
                return (
                  <tr
                    key={c.campaignId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2">{c.campaignName}</td>
                    <td className="px-3 py-2 text-right">{gbp(c.spend)}</td>
                    <td className="px-3 py-2 text-right">
                      {c.revenue > 0 ? gbp(c.revenue) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {c.roas !== null ? c.roas.toFixed(2) : "no purchase data"}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${trend === null ? "text-faint" : trend >= 0 ? "text-emerald-600" : "text-red-500"}`}
                    >
                      {trend === null
                        ? "—"
                        : `${trend >= 0 ? "+" : ""}${trend.toFixed(0)}%`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {c.clicks.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted">
          No performance data yet — connect Meta on the Connections page (with
          your ad account ID), then hit Sync & analyse.
        </p>
      )}

      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Recommendations awaiting your approval ({pending.length})
          </h2>
          <div className="mt-3 space-y-3">
            {pending.map((a) => (
              <ApprovalCard key={a.id} approval={a}>
                <button
                  onClick={() => decide(a.id, "approve")}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(a.id, "reject")}
                  className="rounded-lg border border-border-strong px-3 py-1.5 text-xs "
                >
                  Reject
                </button>
              </ApprovalCard>
            ))}
          </div>
        </section>
      )}

      {decided.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Decided
          </h2>
          <div className="mt-3 space-y-3">
            {decided.slice(0, 10).map((a) => (
              <ApprovalCard key={a.id} approval={a}>
                {a.status === "approved" && a.execution?.status !== "done" && (
                  <button
                    onClick={() => decide(a.id, "approve")}
                    className="rounded-lg border border-border-strong px-3 py-1.5 text-xs "
                  >
                    Retry execution
                  </button>
                )}
              </ApprovalCard>
            ))}
          </div>
        </section>
      )}

      {latestReport && (
        <details className="mt-10 rounded-2xl border border-border p-5 ">
          <summary className="cursor-pointer text-sm font-medium">
            Full performance report
            <span className="ml-2 text-xs font-normal text-muted">
              {new Date(latestReport.createdAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </summary>
          <div className="mt-4 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
            {latestReport.content}
          </div>
        </details>
      )}
    </div>
  );
}

function ApprovalCard({
  approval,
  children,
}: {
  approval: AdApprovalItem;
  children?: React.ReactNode;
}) {
  const exec = approval.execution;
  return (
    <div className="rounded-xl border border-border p-4 ">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-foreground/8 px-2 py-0.5 ">
              {approval.kind}
            </span>
            <span className="text-muted">{approval.campaignName}</span>
            <span className="text-muted">
              confidence: {approval.confidence}
            </span>
            {approval.status !== "pending" && (
              <span
                className={
                  approval.status === "approved"
                    ? "text-emerald-600"
                    : "text-red-500"
                }
              >
                {approval.status}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm">{approval.action}</p>
          {approval.newDailyBudgetGBP !== null && (
            <p className="mt-0.5 text-xs text-muted">
              Proposed daily budget: £{approval.newDailyBudgetGBP}
            </p>
          )}
          {approval.reason && (
            <p className="mt-0.5 text-xs text-muted">{approval.reason}</p>
          )}
          {exec && (
            <p
              className={`mt-1.5 text-xs ${
                exec.status === "done"
                  ? "text-emerald-600"
                  : exec.status === "blocked_app_review"
                    ? "text-amber-600 dark:text-amber-500"
                    : "text-red-500"
              }`}
            >
              {exec.status === "done"
                ? "✓ "
                : exec.status === "blocked_app_review"
                  ? "⏳ "
                  : "✕ "}
              {exec.message}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">{children}</div>
      </div>
    </div>
  );
}
