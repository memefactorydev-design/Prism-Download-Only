// P5.2 — the investor screen. When a VC asks, the answer is this page.
// Admin-only; every number computed live from the funnel, honest about
// thin windows.

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { investorMetrics } from "@/lib/metrics";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

const gbp = (n: number) => `£${n.toFixed(2)}`;
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1.5 text-[26px] font-bold leading-none tracking-[-0.02em]">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export default async function MetricsPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }
  const m = await investorMetrics();
  const maxWeek = Math.max(1, ...m.retention.map((r) => r.active));

  return (
    <div>
      <PageHeader
        title="Metrics"
        subtitle={`The investor answers, live. Instrumented since ${new Date(m.instrumentedSince).toLocaleDateString("en-GB")} — early cohorts are honest about being thin.`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Users" value={String(m.users)} />
        <Tile
          label="Activation"
          value={pct(m.activationRate)}
          sub={`${m.membersActivated} published in week 1 · target >60%`}
        />
        <Tile label="WAU" value={String(m.wau)} sub="any activity, trailing 7d" />
        <Tile
          label="TTFPR median"
          value={m.ttfprMedianMins === null ? "—" : m.ttfprMedianMins < 60 ? `${Math.round(m.ttfprMedianMins)}m` : `${(m.ttfprMedianMins / 60).toFixed(1)}h`}
          sub={`${m.ttfprSamples} sample${m.ttfprSamples === 1 ? "" : "s"} · target <10m`}
        />
        <Tile
          label="Overnight approval"
          value={pct(m.overnightApprovalRate)}
          sub={`${m.overnightSamples} drip drafts decided`}
        />
        <Tile label="MRR" value={m.mrr === null ? "pre-billing" : `£${m.mrr.toLocaleString("en-GB")}`} sub={m.mrr === null ? "beta — no billing system yet" : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="font-display text-sm font-semibold text-foreground">Weekly active users</h3>
          {m.retention.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No weekly data yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {m.retention.map((r) => (
                <div key={r.week} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-muted">{new Date(r.week).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/8">
                    <div className="h-full rounded-full" style={{ width: `${(r.active / maxWeek) * 100}%`, background: "#8B5CF6" }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs font-semibold">{r.active}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-faint">Week-4 retention target: &gt;40%. Cohort curves firm up as instrumentation ages.</p>
        </div>

        <div className="card p-4">
          <h3 className="font-display text-sm font-semibold text-foreground">Unit economics (estimate)</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-faint">COGS this month</p>
              <p className="text-lg font-bold">{gbp(m.cogsMonth)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-faint">COGS / active user</p>
              <p className="text-lg font-bold">{m.cogsPerActiveUser === null ? "—" : gbp(m.cogsPerActiveUser)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-faint">Publishes · 30d</p>
              <p className="text-lg font-bold">{m.publishes30d}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-faint">Gross margin target</p>
              <p className="text-lg font-bold">≥75%</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-faint">
            COGS from metered units × per-unit estimates (env-tunable COGS_*). Margin = (plan price − COGS/user) ÷ plan price once billing lands.
          </p>
        </div>
      </div>
    </div>
  );
}
