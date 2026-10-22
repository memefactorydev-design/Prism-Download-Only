import { redirect } from "next/navigation";
import { getCampaignAggregates, type CampaignAggregate } from "@/lib/ads";
import { listRecentDeals, spendVsRevenue } from "@/lib/deals";
import { SpendVsRevenue } from "@/components/SpendVsRevenue";
import { getConnectionStatuses } from "@/lib/connections";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AdsBoard, type AdApprovalItem, type CampaignRow } from "@/components/AdsBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

function toRows(campaigns: CampaignAggregate[]): CampaignRow[] {
  return campaigns.map((c) => ({
    campaignId: c.campaignId,
    campaignName: c.campaignName,
    spend: c.spend,
    revenue: c.revenue,
    roas: c.roas,
    impressions: c.impressions,
    clicks: c.clicks,
    roasLast7: c.roasLast7,
    roasPrev7: c.roasPrev7,
  }));
}

export default async function AdsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Everything on this page is scoped: the admin sees the business ad accounts
  // and ledger (""), a member sees only their own connections + deals.
  const scope = user.role === "admin" ? "" : user.id;
  const [metaCampaigns, googleCampaigns, allApprovals, metaReport, googleReport, connections, svr, recentDeals] =
    await Promise.all([
      getCampaignAggregates(scope, "meta"),
      getCampaignAggregates(scope, "google"),
      db.approval.findMany({ where: { kind: "ad_budget" }, orderBy: { createdAt: "desc" }, take: 200 }),
      db.agentReport.findFirst({
        where: { agentName: "meta-ads-manager", kind: scope ? `ads_performance:${scope}` : "ads_performance" },
        orderBy: { createdAt: "desc" },
      }),
      db.agentReport.findFirst({
        where: {
          agentName: "google-ads-manager",
          kind: scope ? `google_ads_performance:${scope}` : "google_ads_performance",
        },
        orderBy: { createdAt: "desc" },
      }),
      getConnectionStatuses(user.id, user.role),
      spendVsRevenue(12, scope),
      listRecentDeals(20, scope),
    ]);

  const meta = connections.find((c) => c.provider === "meta");
  const google = connections.find((c) => c.provider === "googleads");
  // From connect-time validation; the live check happens again at execution time.
  const metaWriteState =
    meta?.status === "connected" ? ((meta.metadata?.adsWriteState as string) ?? "pending_app_review") : null;
  const googleWriteState = google?.status === "connected" ? "unlocked" : null;

  // Approval scope + network ride in the payload; split this scope's queue.
  const scoped = allApprovals.filter((a) => {
    const p = JSON.parse(a.payload) as { scopeUserId?: string };
    return (p.scopeUserId ?? "") === scope;
  });
  const toItems = (network: "meta" | "google"): AdApprovalItem[] =>
    scoped
      .filter((a) => {
        const p = JSON.parse(a.payload) as { network?: string };
        return (p.network ?? "meta") === network;
      })
      .slice(0, 50)
      .map((a) => {
        const payload = JSON.parse(a.payload) as {
          kind?: string;
          action?: string;
          campaignName?: string;
          confidence?: string;
          newDailyBudgetGBP?: number;
          execution?: { status: string; message: string };
        };
        return {
          id: a.id,
          status: a.status,
          reason: a.reason,
          action: payload.action ?? "",
          campaignName: payload.campaignName ?? "",
          kind: payload.kind ?? "ad_budget",
          confidence: payload.confidence ?? "—",
          newDailyBudgetGBP: payload.newDailyBudgetGBP ?? null,
          execution: payload.execution ?? null,
          createdAt: a.createdAt.toISOString(),
        };
      });

  const reportItem = (r: typeof metaReport) =>
    r ? { id: r.id, title: r.title, content: r.content, createdAt: r.createdAt.toISOString() } : null;

  return (
    <div>
      <PageHeader
        title="Ads"
        subtitle="Meta and Google performance straight from your own ad accounts. The specialists diagnose and recommend; nothing that changes spend executes without your approval here."
      />
      <SpendVsRevenue
        rows={svr.rows.map((r) => ({ ...r }))}
        totals={{ month: "Total", ...svr.totals }}
        deals={recentDeals.map((d) => ({
          id: d.id,
          wonAt: d.wonAt.toISOString(),
          amount: d.amount,
          source: d.source,
          name: d.name,
          createdVia: d.createdVia,
        }))}
        metaConnected={meta?.status === "connected"}
      />

      <h2 className="mt-10 text-lg font-semibold tracking-[-0.01em]">Meta ads</h2>
      <AdsBoard
        network="meta"
        campaigns={toRows(metaCampaigns)}
        approvals={toItems("meta")}
        latestReport={reportItem(metaReport)}
        writeState={metaWriteState}
      />

      <h2 className="mt-14 border-t border-border pt-10 text-lg font-semibold tracking-[-0.01em]">Google Ads</h2>
      {google?.status === "connected" ? (
        <AdsBoard
          network="google"
          campaigns={toRows(googleCampaigns)}
          approvals={toItems("google")}
          latestReport={reportItem(googleReport)}
          writeState={googleWriteState}
        />
      ) : (
        <p className="mt-3 text-sm text-muted">
          Google Ads isn&rsquo;t connected yet — set it up on the Connections page (developer token, OAuth
          client and refresh token; the card walks you through every step). Once connected, the Google Ads
          manager reads your campaigns, recommends changes, and executes them here after your approval.
        </p>
      )}
    </div>
  );
}
