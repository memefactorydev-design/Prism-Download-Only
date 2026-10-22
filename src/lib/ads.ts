// Meta ads orchestration (Phase 4, read-first):
//   1. syncRoasSnapshots  — Marketing API insights → RoasSnapshot rows
//   2. runAdsAnalysis     — snapshots → meta-ads-manager agent → report +
//                           recommendations; spend-changing ones become
//                           pending Approval rows
//   3. decideAdApproval   — THE gate: only an explicit dashboard approval
//                           executes a write, and only if App Review has
//                           unlocked ads_management. Every other outcome is
//                           a visible status, never a silent failure.

import type { Approval } from "@prisma/client";
import { runAgent } from "@/lib/agents/run-agent";
import { journal } from "@/lib/memory";
import { db } from "@/lib/db";
import {
  fetchCampaignInsights,
  getWriteCapability,
  updateCampaign,
} from "@/lib/meta/marketing-api";
import { track } from "@/lib/events";
import {
  fetchGoogleCampaignInsights,
  getGoogleWriteCapability,
  updateGoogleCampaign,
} from "@/lib/googleads/api";

export type AdNetwork = "meta" | "google";

// Everything here is scoped per user since the beta: "" is the business's ad
// account (the workspace), any other scopeUserId is that beta user's own Meta
// connection — their snapshots, their analysis, their approvals.
export async function syncRoasSnapshots(days = 30, scopeUserId = "", network: AdNetwork = "meta"): Promise<{ synced: number }> {
  const insights =
    network === "google"
      ? await fetchGoogleCampaignInsights(days, scopeUserId)
      : await fetchCampaignInsights(days, scopeUserId);
  let synced = 0;
  for (const row of insights) {
    if (!row.campaignId || !row.date) continue;
    await db.roasSnapshot.upsert({
      where: {
        campaignId_date_userId_network: {
          campaignId: row.campaignId,
          date: new Date(row.date),
          userId: scopeUserId,
          network,
        },
      },
      create: {
        userId: scopeUserId,
        network,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        date: new Date(row.date),
        spend: row.spend,
        revenue: row.revenue,
        roas: row.roas,
        impressions: row.impressions,
        clicks: row.clicks,
        raw: JSON.stringify(row.raw),
      },
      update: {
        campaignName: row.campaignName,
        spend: row.spend,
        revenue: row.revenue,
        roas: row.roas,
        impressions: row.impressions,
        clicks: row.clicks,
        raw: JSON.stringify(row.raw),
      },
    });
    synced++;
  }
  return { synced };
}

export interface CampaignAggregate {
  campaignId: string;
  campaignName: string;
  spend: number;
  revenue: number;
  roas: number | null;
  impressions: number;
  clicks: number;
  spendLast7: number;
  spendPrev7: number;
  roasLast7: number | null;
  roasPrev7: number | null;
  days: number;
}

/** Per-campaign aggregates over the trailing 30 days, with 7-day trend split. */
export async function getCampaignAggregates(scopeUserId = "", network: AdNetwork = "meta"): Promise<CampaignAggregate[]> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const snapshots = await db.roasSnapshot.findMany({
    where: { date: { gte: cutoff }, userId: scopeUserId, network },
    orderBy: { date: "asc" },
  });
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

  const byCampaign = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const list = byCampaign.get(s.campaignId) ?? [];
    list.push(s);
    byCampaign.set(s.campaignId, list);
  }

  const weightedRoas = (rows: typeof snapshots): number | null => {
    const withRoas = rows.filter((r) => r.roas !== null);
    const spend = withRoas.reduce((sum, r) => sum + r.spend, 0);
    if (spend === 0) return null;
    return withRoas.reduce((sum, r) => sum + (r.roas ?? 0) * r.spend, 0) / spend;
  };

  return [...byCampaign.values()].map((rows) => {
    const last7 = rows.filter((r) => r.date.getTime() >= sevenDaysAgo);
    const prev7 = rows.filter(
      (r) => r.date.getTime() >= fourteenDaysAgo && r.date.getTime() < sevenDaysAgo
    );
    return {
      campaignId: rows[0].campaignId,
      campaignName: rows[rows.length - 1].campaignName,
      spend: rows.reduce((sum, r) => sum + r.spend, 0),
      revenue: rows.reduce((sum, r) => sum + (r.revenue ?? 0), 0),
      roas: weightedRoas(rows),
      impressions: rows.reduce((sum, r) => sum + (r.impressions ?? 0), 0),
      clicks: rows.reduce((sum, r) => sum + (r.clicks ?? 0), 0),
      spendLast7: last7.reduce((sum, r) => sum + r.spend, 0),
      spendPrev7: prev7.reduce((sum, r) => sum + r.spend, 0),
      roasLast7: weightedRoas(last7),
      roasPrev7: weightedRoas(prev7),
      days: rows.length,
    };
  });
}

// ─── Agent analysis ──────────────────────────────────────────────────────────

interface Recommendation {
  kind: "budget_change" | "pause" | "resume" | "advisory";
  campaignId: string;
  campaignName: string;
  action: string;
  expectedImpact: string;
  confidence: "low" | "medium" | "high";
  newDailyBudgetGBP?: number;
}

interface AdsPayload {
  reportMarkdown: string;
  recommendations: Recommendation[];
  dataCaveats: string[];
}

const ADS_SCHEMA = {
  type: "object",
  properties: {
    reportMarkdown: {
      type: "string",
      description: "Full performance report as markdown, following your output format.",
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["budget_change", "pause", "resume", "advisory"],
            description:
              "budget_change/pause/resume are executable spend actions needing approval; advisory is a suggestion with no direct API action (e.g. creative rotation).",
          },
          campaignId: { type: "string" },
          campaignName: { type: "string" },
          action: { type: "string", description: "What to do, in one plain sentence." },
          expectedImpact: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          newDailyBudgetGBP: {
            type: "number",
            description: "Required when kind is budget_change: the proposed new daily budget in GBP.",
          },
        },
        required: ["kind", "campaignId", "campaignName", "action", "expectedImpact", "confidence"],
        additionalProperties: false,
      },
    },
    dataCaveats: { type: "array", items: { type: "string" } },
  },
  required: ["reportMarkdown", "recommendations", "dataCaveats"],
  additionalProperties: false,
};

export interface AdsAnalysisSummary {
  synced: number;
  reportId: string;
  approvalsCreated: number;
  advisories: number;
  writeUnlocked: boolean;
}

export async function runAdsAnalysis(
  scopeUserId = "",
  network: AdNetwork = "meta",
  opts: { challenger?: boolean; capPct?: number } = {}
): Promise<AdsAnalysisSummary> {
  const { synced } = await syncRoasSnapshots(30, scopeUserId, network);
  const aggregates = await getCampaignAggregates(scopeUserId, network);
  if (aggregates.length === 0) {
    throw new Error(
      "No campaign data found for the last 30 days. If the ad account has live campaigns, check the account ID on the Connections page."
    );
  }
  const capability =
    network === "google" ? await getGoogleWriteCapability(scopeUserId) : await getWriteCapability(scopeUserId);

  const networkLabel = network === "google" ? "Google Ads" : "Meta";
  const capPct = Math.min(Math.max(opts.capPct ?? 10, 5), 20);
  const task = [
    opts.challenger
      ? `Run a CHAMPION / CHALLENGER analysis of the ${networkLabel} account (trailing 30 days). Identify the champion (best spend-weighted ROAS with meaningful spend) and treat lower-spend campaigns as challengers. Recommend: (a) budget shifts that give promising challengers up to ${capPct}% of total daily budget — never more; (b) pausing challengers ONLY where they have at least 72 hours of data and clearly lose to the champion; (c) promoting any challenger that beats the champion. Every recommendation in plain English a business owner follows at a glance ("Challenger B beat your champion by 23% CPL — promote it"). The ${capPct}% cap is a hard limit set by the owner.`
      : `Analyse the ${networkLabel} ad performance for the trailing 30 days and produce your report.`,
    "",
    `Write capability status: ${
      capability.unlocked
        ? "UNLOCKED — write actions can execute after owner approval."
        : "BLOCKED — " +
          capability.reason +
          " Tag write recommendations [BLOCKED] in the report, but still emit them as structured recommendations so they queue."
    }`,
    "",
    "## Per-campaign aggregates (30 days, account currency; roas values are spend-weighted; *Last7/*Prev7 split for trend)",
    "```json",
    JSON.stringify(aggregates, null, 2),
    "```",
    "",
    "Every executable recommendation must reference a real campaignId from the data. Mark anything uncertain honestly in dataCaveats — attribution windows, campaigns without conversion tracking (roas null means no conversion data, NOT zero performance).",
  ].join("\n");

  const agentName = network === "google" ? "google-ads-manager" : "meta-ads-manager";
  const baseKind = network === "google" ? "google_ads_performance" : "ads_performance";
  const { report, data } = await runAgent<AdsPayload>(agentName, task, {
    schema: ADS_SCHEMA,
    // Member analyses store under a scoped kind so each user's /ads page shows
    // THEIR latest report (AgentReport has no user column on purpose — reports
    // are workspace artefacts; the scoped kind is the one per-user exception).
    reportKind: scopeUserId ? `${baseKind}:${scopeUserId}` : baseKind,
    reportTitle: opts.challenger ? `${networkLabel} champion / challenger` : `${networkLabel} ads performance & recommendations`,
    scopeUserId,
  });
  if (!data) throw new Error("meta-ads-manager returned no structured data.");

  let approvalsCreated = 0;
  let advisories = 0;
  for (const rec of data.recommendations) {
    if (rec.kind === "advisory") {
      advisories++;
      continue;
    }
    if (rec.kind === "budget_change" && typeof rec.newDailyBudgetGBP !== "number") {
      continue; // malformed — the report still shows it as text
    }
    await db.approval.create({
      data: {
        kind: "ad_budget",
        status: "pending",
        reason: `${rec.action} — expected impact: ${rec.expectedImpact} (confidence: ${rec.confidence})`,
        // scopeUserId + network ride in the payload: they pin WHOSE ad account
        // (and which network) the action executes against, and WHO may decide.
        payload: JSON.stringify({ ...rec, reportId: report.id, scopeUserId, network }),
      },
    });
    approvalsCreated++;
  }

  return { synced, reportId: report.id, approvalsCreated, advisories, writeUnlocked: capability.unlocked };
}

// ─── Approval gate ───────────────────────────────────────────────────────────

export async function decideAdApproval(
  id: string,
  decision: "approve" | "reject",
  actor: { id: string; role: string }
): Promise<Approval> {
  track("ad_action_decided", "", { approvalId: id, decision });
  const approval = await db.approval.findUnique({ where: { id } });
  if (!approval || approval.kind !== "ad_budget") throw new Error("Ad approval not found.");
  const payload = JSON.parse(approval.payload) as Recommendation & {
    scopeUserId?: string;
    network?: AdNetwork;
    execution?: { status: string; message: string };
  };
  // Only the scope's owner decides: the admin for the business ad account (""),
  // each beta user for recommendations against their own ad account — the spend
  // is theirs, so the decision is too.
  const scope = payload.scopeUserId ?? "";
  const actorScope = actor.role === "admin" ? "" : actor.id;
  if (scope !== actorScope) throw new Error("Ad approval not found.");

  const network: AdNetwork = payload.network === "google" ? "google" : "meta";

  // Beta users' sandboxes must not colour the brand agent's dream memory.
  const journalOutcome = (status: string, detail?: string) => {
    if (scope !== "") return;
    journal(network === "google" ? "google-ads-manager" : "meta-ads-manager", {
      kind: "outcome",
      item: "spend recommendation",
      title: `${payload.campaignName}: ${payload.action}`,
      status,
      ...(detail === undefined ? {} : { detail }),
    });
  };

  if (decision === "reject") {
    if (approval.status !== "pending") throw new Error(`This recommendation is already ${approval.status}.`);
    journalOutcome("rejected");
    return db.approval.update({
      where: { id },
      data: { status: "rejected", decidedAt: new Date() },
    });
  }

  // approve — also retries execution for an approved-but-blocked/failed action
  if (approval.status === "rejected") throw new Error("This recommendation was rejected — re-run the analysis to regenerate it.");

  const execution = await execute(payload, scope, network);
  journalOutcome(`approved — execution ${execution.status}`, execution.message);
  return db.approval.update({
    where: { id },
    data: {
      status: "approved",
      decidedAt: approval.decidedAt ?? new Date(),
      payload: JSON.stringify({ ...payload, execution }),
    },
  });
}

async function execute(
  rec: Recommendation,
  scopeUserId = "",
  network: AdNetwork = "meta"
): Promise<{ status: string; message: string }> {
  let capability;
  try {
    capability =
      network === "google" ? await getGoogleWriteCapability(scopeUserId) : await getWriteCapability(scopeUserId);
  } catch (err) {
    return { status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
  if (!capability.unlocked) {
    return { status: network === "google" ? "blocked" : "blocked_app_review", message: capability.reason };
  }
  const budget = Math.round((rec.newDailyBudgetGBP ?? 0) * 100);
  try {
    switch (rec.kind) {
      case "budget_change":
        if (network === "google") await updateGoogleCampaign(rec.campaignId, { dailyBudgetMinorUnits: budget }, scopeUserId);
        else await updateCampaign(rec.campaignId, { dailyBudgetMinorUnits: budget }, scopeUserId);
        return { status: "done", message: `Daily budget set to £${rec.newDailyBudgetGBP} for ${rec.campaignName}.` };
      case "pause":
        if (network === "google") await updateGoogleCampaign(rec.campaignId, { status: "PAUSED" }, scopeUserId);
        else await updateCampaign(rec.campaignId, { status: "PAUSED" }, scopeUserId);
        return { status: "done", message: `${rec.campaignName} paused.` };
      case "resume":
        if (network === "google") await updateGoogleCampaign(rec.campaignId, { status: "ENABLED" }, scopeUserId);
        else await updateCampaign(rec.campaignId, { status: "ACTIVE" }, scopeUserId);
        return { status: "done", message: `${rec.campaignName} resumed.` };
      default:
        return { status: "failed", message: `Unknown action kind "${rec.kind}".` };
    }
  } catch (err) {
    return { status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}
