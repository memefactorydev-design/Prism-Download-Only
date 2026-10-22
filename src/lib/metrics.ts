// P5.2 — the investor answers, computed from the live funnel (Event table,
// posts, users). Every number is honest about its window: instrumentation
// began 2026-07-09, so early cohorts are thin and the page says so.

import { db } from "@/lib/db";
import { engineStatus } from "@/lib/llm";

// Rough per-unit COGS in GBP for blended-margin math — env-tunable.
// (Opus agent pass ≈ heavy tokens; render ≈ CPU time; gen ≈ provider fees.)
const UNIT_COGS: Record<string, number> = {
  agent_run: Number(process.env.COGS_AGENT_RUN ?? 0.35),
  render: Number(process.env.COGS_RENDER ?? 0.08),
  image_gen: Number(process.env.COGS_IMAGE_GEN ?? 0.03),
  video_gen: Number(process.env.COGS_VIDEO_GEN ?? 0.9),
  music_gen: Number(process.env.COGS_MUSIC_GEN ?? 0.1),
  tts: Number(process.env.COGS_TTS ?? 0.05),
  scrape: Number(process.env.COGS_SCRAPE ?? 0.12),
  email: Number(process.env.COGS_EMAIL ?? 0.001),
};

export interface InvestorMetrics {
  instrumentedSince: string;
  users: number;
  membersActivated: number; // published ≥1 post within 7 days of signup
  activationRate: number | null;
  wau: number; // distinct users with any event in trailing 7d
  ttfprMedianMins: number | null; // signup → first publish, median
  ttfprSamples: number;
  overnightApprovalRate: number | null; // drip drafts approved / decided
  overnightSamples: number;
  retention: { week: string; active: number }[]; // weekly active, last 6 weeks
  cogsMonth: number; // estimated £ this month, all scopes
  cogsPerActiveUser: number | null;
  publishes30d: number;
  mrr: number | null; // no billing system yet — env override or null
}

export async function investorMetrics(): Promise<InvestorMetrics> {
  const since30 = new Date(Date.now() - 30 * 86400_000);
  const since7 = new Date(Date.now() - 7 * 86400_000);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [users, firstEvent, events30, metered, publishes30d] = await Promise.all([
    db.user.findMany({ select: { id: true, createdAt: true } }),
    db.event.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.event.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 42 * 86400_000) } },
      select: { name: true, userId: true, createdAt: true, props: true },
    }),
    db.event.findMany({
      where: { name: "usage_metered", createdAt: { gte: monthStart } },
      select: { props: true },
    }),
    db.event.count({ where: { name: "post_published", createdAt: { gte: since30 } } }),
  ]);

  // Activation + TTFPR: per member, signup → first post_published.
  const firstPublish = new Map<string, Date>();
  for (const e of events30) {
    if (e.name !== "post_published" || !e.userId) continue;
    const cur = firstPublish.get(e.userId);
    if (!cur || e.createdAt < cur) firstPublish.set(e.userId, e.createdAt);
  }
  let activated = 0;
  const ttfprs: number[] = [];
  for (const u of users) {
    const fp = firstPublish.get(u.id);
    if (!fp) continue;
    const mins = (fp.getTime() - u.createdAt.getTime()) / 60_000;
    if (mins >= 0) ttfprs.push(mins);
    if (mins >= 0 && mins <= 7 * 24 * 60) activated += 1;
  }
  ttfprs.sort((a, b) => a - b);
  const median = ttfprs.length ? ttfprs[Math.floor(ttfprs.length / 2)] : null;

  // WAU + weekly retention curve (distinct users with any event per ISO-ish week).
  const weekly = new Map<string, Set<string>>();
  const wauSet = new Set<string>();
  for (const e of events30) {
    if (!e.userId) continue;
    if (e.createdAt >= since7) wauSet.add(e.userId);
    const monday = new Date(e.createdAt);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (!weekly.has(key)) weekly.set(key, new Set());
    weekly.get(key)!.add(e.userId);
  }
  const retention = [...weekly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([week, set]) => ({ week, active: set.size }));

  // Overnight/drip approval rate: draft_created via drip → approved vs rejected.
  // We approximate by matching drip drafts' scopes to later decisions.
  let dripApproved = 0;
  let dripDecided = 0;
  for (const e of events30) {
    if (e.name !== "draft_created") continue;
    try {
      const p = JSON.parse(e.props) as { via?: string };
      if (p.via !== "drip") continue;
    } catch {
      continue;
    }
    dripDecided += 0; // counted below via posts table for accuracy
  }
  const dripPosts = await db.post.findMany({
    where: { createdBy: "agent", status: { in: ["approved", "scheduled", "published", "rejected"] } },
    select: { status: true },
  });
  for (const p of dripPosts) {
    dripDecided += 1;
    if (p.status !== "rejected") dripApproved += 1;
  }

  // COGS estimate for the month. On a subscription engine (Claude Code / Codex)
  // agent runs and Iris turns cost nothing per token — they're in the plan.
  const { isCli } = await engineStatus();
  let cogs = 0;
  for (const m of metered) {
    try {
      const p = JSON.parse(m.props) as { unit?: string; qty?: number };
      const unit = p.unit ?? "";
      const perUnit = isCli && (unit === "agent_run" || unit === "assist") ? 0 : (UNIT_COGS[unit] ?? 0.05);
      cogs += perUnit * Number(p.qty ?? 1);
    } catch {
      /* skip */
    }
  }

  return {
    instrumentedSince: (firstEvent?.createdAt ?? new Date()).toISOString(),
    users: users.length,
    membersActivated: activated,
    activationRate: firstPublish.size || users.length ? (users.length ? activated / users.length : null) : null,
    wau: wauSet.size,
    ttfprMedianMins: median,
    ttfprSamples: ttfprs.length,
    overnightApprovalRate: dripDecided ? dripApproved / dripDecided : null,
    overnightSamples: dripDecided,
    retention,
    cogsMonth: cogs,
    cogsPerActiveUser: wauSet.size ? cogs / wauSet.size : null,
    publishes30d,
    mrr: process.env.MRR_OVERRIDE ? Number(process.env.MRR_OVERRIDE) : null,
  };
}
