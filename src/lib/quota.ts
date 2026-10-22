// Per-plan monthly video-generation quotas. Video is the ONE metered unit
// expensive enough to sink a plan's margin (docs/COSTS-2026-07.md), so it gets
// a hard monthly allowance; everything else stays on the soft count that
// /usage surfaces past 80%.
//
// The plan belongs to the DEPLOYMENT (one customer = one instance), so the
// allowance is shared by every member — usage is counted across all scopes.
// No PRISM_PLAN set = no hard quota (pre-billing behaviour, unchanged); set it
// per customer at provisioning time. VIDEO_QUOTA_OVERRIDE wins over the plan
// map for bespoke deals.

import { db } from "@/lib/db";

/** Included AI video generations per month, by plan (mirrors the hosted plans). */
export const PLAN_VIDEO_QUOTAS: Record<string, number> = {
  starter: 10,
  growth: 40,
  agency: 120,
  enterprise: 300,
};

/** The active monthly allowance, or null when no plan/override is configured. */
export function videoQuota(): number | null {
  const override = Number(process.env.VIDEO_QUOTA_OVERRIDE || "");
  if (Number.isFinite(override) && override > 0) return Math.round(override);
  const plan = (process.env.PRISM_PLAN || "").trim().toLowerCase();
  if (!plan) return null;
  const quota = PLAN_VIDEO_QUOTAS[plan];
  if (!quota) {
    // A configured-but-unknown plan is a provisioning mistake — fail loudly
    // rather than silently running uncapped.
    throw new Error(`PRISM_PLAN "${plan}" isn't a known plan (${Object.keys(PLAN_VIDEO_QUOTAS).join("/")}).`);
  }
  return quota;
}

/** video_gen units metered this calendar month, across ALL members. */
export async function videoGensUsedThisMonth(): Promise<number> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  // meterUsage writes `unit` as the first key, so the JSON substring is stable.
  const events = await db.event.findMany({
    where: { name: "usage_metered", createdAt: { gte: monthStart }, props: { contains: '"unit":"video_gen"' } },
    select: { props: true },
  });
  let total = 0;
  for (const e of events) {
    try {
      const p = JSON.parse(e.props) as { unit?: string; qty?: number };
      if (p.unit === "video_gen") total += Number(p.qty ?? 1);
    } catch {
      /* skip malformed */
    }
  }
  return total;
}

export async function videoQuotaState(): Promise<{ quota: number | null; used: number; remaining: number | null }> {
  const quota = videoQuota();
  if (quota == null) return { quota: null, used: 0, remaining: null };
  const used = await videoGensUsedThisMonth();
  return { quota, used, remaining: Math.max(0, quota - used) };
}

/** Thrown when an action would exceed the monthly allowance. Member-safe copy. */
export class VideoQuotaError extends Error {
  constructor(quota: number, used: number, needed: number) {
    super(
      needed > 1
        ? `This needs ${needed} AI video generations but only ${Math.max(0, quota - used)} of this month's ${quota} are left. The allowance resets on the 1st — or ask about a bigger plan.`
        : `This month's ${quota} included AI video generations are used up. The allowance resets on the 1st — or ask about a bigger plan.`
    );
    this.name = "VideoQuotaError";
  }
}

/**
 * Gate a spend of `needed` video generations. No-op without a configured plan.
 * Routes let the error surface to the user (422); the morph bridge path
 * catches it and degrades to a free dissolve.
 */
export async function assertVideoQuota(needed = 1): Promise<void> {
  const quota = videoQuota();
  if (quota == null) return;
  const used = await videoGensUsedThisMonth();
  if (used + needed > quota) throw new VideoQuotaError(quota, used, needed);
}
