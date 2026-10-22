// P4.7 — usage in plain English. No credit maths, no meter anxiety: what
// Prism did for you this month, in sentences. The soft allowance surfaces
// ONLY past 80% — below that, the absence of a meter is the feature.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { videoQuotaState } from "@/lib/quota";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

// Generous soft ceiling on metered units/month; override with USAGE_SOFT_LIMIT.
const SOFT_LIMIT = Number(process.env.USAGE_SOFT_LIMIT ?? 600);

const LINES: Record<string, (n: number) => string> = {
  render: (n) => `cut and rendered ${n} video${n === 1 ? "" : "s"}`,
  agent_run: (n) => `ran ${n} research, writing and planning pass${n === 1 ? "" : "es"}`,
  image_gen: (n) => `generated ${n} image${n === 1 ? "" : "s"}`,
  video_gen: (n) => `generated ${n} AI video clip${n === 1 ? "" : "s"}`,
  music_gen: (n) => `composed ${n} original track${n === 1 ? "" : "s"}`,
  tts: (n) => `recorded ${n} voice-over${n === 1 ? "" : "s"}`,
  scrape: (n) => `ran ${n} live market sweep${n === 1 ? "" : "s"}`,
  email: (n) => `sent ${n} newsletter batch${n === 1 ? "" : "es"}`,
  assist: (n) => `answered ${n} question${n === 1 ? "" : "s"} in chat`,
};

export default async function UsagePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const scope = scopeOf(user);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const events = await db.event.findMany({
    where: { name: "usage_metered", userId: scope, createdAt: { gte: monthStart } },
    select: { props: true },
  });
  const byUnit = new Map<string, number>();
  let total = 0;
  for (const e of events) {
    try {
      const p = JSON.parse(e.props) as { unit?: string; qty?: number };
      const qty = Number(p.qty ?? 1);
      byUnit.set(p.unit ?? "other", (byUnit.get(p.unit ?? "other") ?? 0) + qty);
      total += qty;
    } catch {
      /* skip malformed */
    }
  }
  const pct = Math.round((total / SOFT_LIMIT) * 100);
  const monthName = monthStart.toLocaleDateString("en-GB", { month: "long" });
  // Video generation is the one hard-capped unit (shared workspace allowance);
  // shown only when a plan is configured on this deployment.
  const videoState = await videoQuotaState();

  return (
    <div>
      <PageHeader
        title="Usage"
        subtitle="Everything's included in your plan — no API keys, no credit maths. This page is simply what Prism has done for you this month, in plain English."
      />

      {videoState.quota != null && (
        <div className="card mb-5 p-4 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-medium text-foreground">AI video generations</p>
            <p className="text-muted">
              {Math.min(videoState.used, videoState.quota)} of {videoState.quota} used in {monthName}
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.min(100, Math.round((videoState.used / videoState.quota) * 100))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-faint">
            Ad clips, ad-film shots, morph transitions and site hero videos share this workspace allowance. It resets
            on the 1st{videoState.remaining === 0 ? " — it's fully used for this month" : ""}.
          </p>
        </div>
      )}

      {pct >= 80 && (
        <div className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium text-foreground">You&rsquo;re a heavy user this month — nice.</p>
          <p className="mt-1 text-muted">
            You&rsquo;ve used about {Math.min(pct, 100)}% of the fair-use allowance for {monthName}. Nothing stops at
            100% — if you hit it regularly we&rsquo;ll suggest a plan that fits better, that&rsquo;s all.
          </p>
        </div>
      )}

      <div className="card p-5">
        <h2 className="font-display text-base font-semibold text-foreground">In {monthName}, Prism…</h2>
        {byUnit.size === 0 ? (
          <p className="mt-3 text-sm text-muted">…hasn&rsquo;t done any heavy lifting yet. Drop some footage in the Studio and this page fills up.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {[...byUnit.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([unit, n]) => (
                <li key={unit} className="flex gap-2.5 text-sm text-muted">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {(LINES[unit] ?? ((x: number) => `did ${x} other thing${x === 1 ? "" : "s"}`))(n)}
                </li>
              ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-faint">
          Publishing, approvals, the calendar, leads and reports don&rsquo;t count toward anything — they&rsquo;re
          simply yours.
        </p>
      </div>
    </div>
  );
}
