// Live KPI assembly for the /reports dashboard. Everything is scoped (""=
// workspace, else the member's sandbox) and computed from the same sources the
// rest of the app uses — snapshots, the deal ledger, leads, posts, newsletters.
// GSC totals are cached briefly per scope: it's an external API and the
// dashboard auto-refreshes.

import { db } from "@/lib/db";
import { LEAD_STATUSES } from "@/lib/leads";
import type { SocialInsights } from "@/lib/meta/page-insights";

export interface NetworkSummary {
  spend: number;
  impressions: number;
  clicks: number;
  pixelRevenue: number; // platform-reported conversion value — never "banked"
  pixelRoas: number | null;
}

export interface GscSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
  topQueries: { key: string; clicks: number; impressions: number; position: number }[];
}

export interface DashboardKpis {
  windowDays: number;
  adSpend: number; // both networks, 30d
  metaSpend: number;
  googleSpend: number;
  revenue: number; // won deals, 30d
  dealCount: number;
  blendedRoas: number | null;
  leadsNew: number; // created in window
  leadsBooked: number; // booked in window (by lastTouch)
  leadConversion: number | null; // booked / created (window)
  pipeline: { status: string; count: number }[]; // all-time by status
  postsPublished: number; // window
  newslettersSent: number; // window
  gscClicks: number | null; // 28d, null = not connected
  topCampaigns: { network: string; name: string; spend: number; revenue: number | null; roas: number | null }[];
  // v2: the full analytics spread
  channelPosts: { channel: string; published: number; scheduled: number }[]; // window, from real publishing data
  gsc: GscSummary | null; // measured search analytics (null = not connected)
  meta: NetworkSummary | null;
  google: NetworkSummary | null;
  seo: { snapshot: string; openFixes: number; auditedAt: string } | null; // latest audit
  contentPublished: number; // blog/FAQ pieces published, window
  gbpPostsPublished: number; // Google Business posts via the calendar, window
  social: SocialInsights | null; // Facebook Page + Instagram engagement (null = Meta not connected)
}

const socialCache = new Map<string, { at: number; insights: SocialInsights | null }>();

async function socialInsights(scope: string): Promise<SocialInsights | null> {
  const hit = socialCache.get(scope);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.insights;
  let insights: SocialInsights | null = null;
  try {
    const { fetchSocialInsights } = await import("@/lib/meta/page-insights");
    insights = await fetchSocialInsights(scope);
  } catch {
    insights = null;
  }
  socialCache.set(scope, { at: Date.now(), insights });
  return insights;
}

const gscCache = new Map<string, { at: number; summary: GscSummary | null }>();

async function gscSummary(scope: string): Promise<GscSummary | null> {
  const hit = gscCache.get(scope);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.summary;
  let summary: GscSummary | null = null;
  try {
    const { fetchSearchPerformance } = await import("@/lib/gsc");
    const perf = await fetchSearchPerformance(scope);
    const impressions = perf.topQueries.reduce((t, r) => t + r.impressions, 0);
    const weightedPos = perf.topQueries.reduce((t, r) => t + r.position * r.impressions, 0);
    summary = {
      clicks: perf.totals.clicks,
      impressions,
      ctr: impressions > 0 ? perf.totals.clicks / impressions : 0,
      avgPosition: impressions > 0 ? weightedPos / impressions : 0,
      topQueries: perf.topQueries.slice(0, 5).map((q) => ({
        key: q.key,
        clicks: q.clicks,
        impressions: q.impressions,
        position: q.position,
      })),
    };
  } catch {
    summary = null; // not connected (or API blip) — the section simply doesn't show
  }
  gscCache.set(scope, { at: Date.now(), summary });
  return summary;
}

export async function dashboardKpis(scope: string): Promise<DashboardKpis> {
  const windowDays = 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [snapshots, deals, leadsCreated, leadsBookedTouched, pipelineRaw, postsPublished, newsletters, gsc, social, channelRaw, latestAudit, contentPublished] =
    await Promise.all([
      db.roasSnapshot.findMany({ where: { userId: scope, date: { gte: since } } }),
      db.deal.findMany({ where: { userId: scope, wonAt: { gte: since } } }),
      db.lead.count({ where: { userId: scope, createdAt: { gte: since } } }),
      db.lead.count({ where: { userId: scope, status: "booked", lastTouch: { gte: since } } }),
      db.lead.groupBy({ by: ["status"], where: { userId: scope }, _count: { _all: true } }),
      db.post.count({ where: { userId: scope, status: "published", publishedAt: { gte: since } } }),
      db.newsletter.aggregate({
        where: { userId: scope, sentAt: { gte: since } },
        _sum: { sentCount: true },
      }),
      gscSummary(scope),
      socialInsights(scope),
      db.post.groupBy({
        by: ["channel", "status"],
        where: { userId: scope, updatedAt: { gte: since }, status: { in: ["published", "scheduled"] } },
        _count: { _all: true },
      }),
      db.agentReport.findFirst({
        where: { agentName: "seo-geo-agent", kind: scope ? `seo_audit:${scope}` : "seo_audit" },
        orderBy: { createdAt: "desc" },
      }),
      db.contentDraft.count({ where: { userId: scope, status: "published", updatedAt: { gte: since } } }),
    ]);

  const metaSpend = snapshots.filter((s) => s.network !== "google").reduce((t, s) => t + s.spend, 0);
  const googleSpend = snapshots.filter((s) => s.network === "google").reduce((t, s) => t + s.spend, 0);
  const adSpend = metaSpend + googleSpend;
  const revenue = deals.reduce((t, d) => t + d.amount, 0);

  const pipeline = LEAD_STATUSES.map((status) => ({
    status,
    count: pipelineRaw.find((p) => p.status === status)?._count._all ?? 0,
  }));

  // Top campaigns by spend, both networks, from the same 30d snapshots.
  const byCampaign = new Map<string, { network: string; name: string; spend: number; revenue: number }>();
  for (const s of snapshots) {
    const key = `${s.network}:${s.campaignId}`;
    const c = byCampaign.get(key) ?? { network: s.network, name: s.campaignName, spend: 0, revenue: 0 };
    c.spend += s.spend;
    c.revenue += s.revenue ?? 0;
    c.name = s.campaignName;
    byCampaign.set(key, c);
  }
  const topCampaigns = [...byCampaign.values()]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8)
    .map((c) => ({
      network: c.network,
      name: c.name,
      spend: c.spend,
      revenue: c.revenue || null,
      roas: c.revenue && c.spend > 0 ? c.revenue / c.spend : null,
    }));

  // Per-network platform analytics from the same snapshots (impressions/clicks
  // + platform-reported conversion value — labelled pixel*, never "banked").
  const networkSummary = (network: string): NetworkSummary | null => {
    const rows = snapshots.filter((s) => (s.network ?? "meta") === network);
    if (!rows.length) return null;
    const spend = rows.reduce((t, s) => t + s.spend, 0);
    const pixelRevenue = rows.reduce((t, s) => t + (s.revenue ?? 0), 0);
    return {
      spend,
      impressions: rows.reduce((t, s) => t + (s.impressions ?? 0), 0),
      clicks: rows.reduce((t, s) => t + (s.clicks ?? 0), 0),
      pixelRevenue,
      pixelRoas: spend > 0 && pixelRevenue > 0 ? pixelRevenue / spend : null,
    };
  };

  // Channel publishing activity from real Post rows (per-platform engagement
  // needs each platform's own analytics API — publishing volume is what we can
  // measure honestly from here).
  const channelMap = new Map<string, { published: number; scheduled: number }>();
  for (const row of channelRaw) {
    const c = channelMap.get(row.channel) ?? { published: 0, scheduled: 0 };
    if (row.status === "published") c.published += row._count._all;
    else c.scheduled += row._count._all;
    channelMap.set(row.channel, c);
  }
  const channelPosts = [...channelMap.entries()]
    .map(([channel, v]) => ({ channel, ...v }))
    .sort((a, b) => b.published + b.scheduled - (a.published + a.scheduled));

  let seo: DashboardKpis["seo"] = null;
  if (latestAudit?.data) {
    try {
      const auditData = JSON.parse(latestAudit.data) as { scoreSnapshot?: string; fixes?: unknown[] };
      seo = {
        snapshot: auditData.scoreSnapshot ?? "",
        openFixes: auditData.fixes?.length ?? 0,
        auditedAt: latestAudit.createdAt.toISOString(),
      };
    } catch {
      seo = null;
    }
  }

  return {
    windowDays,
    adSpend,
    metaSpend,
    googleSpend,
    revenue,
    dealCount: deals.length,
    blendedRoas: adSpend > 0 ? revenue / adSpend : null,
    leadsNew: leadsCreated,
    leadsBooked: leadsBookedTouched,
    leadConversion: leadsCreated > 0 ? leadsBookedTouched / leadsCreated : null,
    pipeline,
    postsPublished,
    newslettersSent: newsletters._sum.sentCount ?? 0,
    gscClicks: gsc?.clicks ?? null,
    topCampaigns,
    channelPosts,
    gsc,
    meta: networkSummary("meta"),
    google: networkSummary("google"),
    seo,
    contentPublished,
    gbpPostsPublished: channelMap.get("gbp")?.published ?? 0,
    social,
  };
}
