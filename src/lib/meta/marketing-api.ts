// Meta Marketing API — ad performance/ROAS reading and (gated) campaign writes.
//
// READ-FIRST DESIGN:
//  - Reading insights works with a dev-mode app + ads_read on your own ad account.
//  - CREATING/EDITING campaigns requires ads_management + Meta App Review.
//    Until review passes, every write surfaces as "blocked_app_review" —
//    a visible state in the dashboard, never a silent failure.
//  - Even after review, every spend-changing action requires an approved
//    Approval record before execution. Enforced in lib/ads.ts.

import { getSecrets } from "@/lib/connections";

const GRAPH = "https://graph.facebook.com/v23.0";

export interface CampaignDayInsight {
  campaignId: string;
  campaignName: string;
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  revenue: number | null; // omni_purchase action value
  roas: number | null; // omni_purchase ROAS
  raw: Record<string, unknown>;
}

// Meta is a PER-USER connection: "" is the workspace's (the business ad
// account), any other value is that beta user's own Meta app + ad account.
async function requireMetaConfig(scopeUserId = "") {
  const secrets = await getSecrets("meta", scopeUserId);
  if (!secrets?.accessToken || !secrets.adAccountId) {
    throw new Error(
      "Meta is not connected yet (or missing an ad account ID). See the Connections page."
    );
  }
  return {
    token: secrets.accessToken,
    adAccountId: secrets.adAccountId.replace(/^act_/, ""),
  };
}

function metaError(json: { error?: { message?: string } }, res: Response): Error {
  return new Error(`Meta Marketing API: ${json.error?.message ?? `HTTP ${res.status}`}`);
}

/** Daily campaign-level insights for the trailing window, following pagination. */
export async function fetchCampaignInsights(days = 30, scopeUserId = ""): Promise<CampaignDayInsight[]> {
  const { token, adAccountId } = await requireMetaConfig(scopeUserId);
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    level: "campaign",
    fields: "campaign_id,campaign_name,spend,impressions,clicks,purchase_roas,action_values",
    time_increment: "1",
    time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }),
    limit: "200",
    access_token: token,
  });

  const rows: CampaignDayInsight[] = [];
  let url: string | null = `${GRAPH}/act_${adAccountId}/insights?${params}`;
  for (let page = 0; url && page < 10; page++) {
    const res: Response = await fetch(url);
    const json = (await res.json()) as {
      data?: Record<string, unknown>[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!res.ok || json.error) throw metaError(json, res);

    for (const row of json.data ?? []) {
      const purchaseRoas = (row.purchase_roas as { action_type: string; value: string }[]) ?? [];
      const actionValues = (row.action_values as { action_type: string; value: string }[]) ?? [];
      const roas = purchaseRoas.find((a) => a.action_type === "omni_purchase")?.value;
      const revenue = actionValues.find((a) => a.action_type === "omni_purchase")?.value;
      rows.push({
        campaignId: String(row.campaign_id ?? ""),
        campaignName: String(row.campaign_name ?? ""),
        date: String(row.date_start ?? ""),
        spend: Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        revenue: revenue !== undefined ? Number(revenue) : null,
        roas: roas !== undefined ? Number(roas) : null,
        raw: row,
      });
    }
    url = json.paging?.next ?? null;
  }
  return rows;
}

export interface WriteCapability {
  unlocked: boolean;
  reason: string;
}

/** Live check: are campaign writes unlocked (ads_management granted post-App-Review)? */
export async function getWriteCapability(scopeUserId = ""): Promise<WriteCapability> {
  const { token } = await requireMetaConfig(scopeUserId);
  const res = await fetch(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    return { unlocked: false, reason: `Could not verify permissions (HTTP ${res.status}).` };
  }
  const json = (await res.json()) as { data?: { permission: string; status: string }[] };
  const granted = (json.data ?? []).some(
    (p) => p.permission === "ads_management" && p.status === "granted"
  );
  return granted
    ? { unlocked: true, reason: "ads_management granted." }
    : {
        unlocked: false,
        reason:
          "ads_management not granted — campaign writes stay locked until your Meta app passes App Review. Reading insights works in the meantime.",
      };
}

export interface CampaignUpdate {
  dailyBudgetMinorUnits?: number; // e.g. pence for GBP accounts
  status?: "ACTIVE" | "PAUSED";
}

/**
 * Update a campaign. ONLY reachable through an approved Approval record via
 * lib/ads.ts — never exposed to agents or called directly from routes.
 */
export async function updateCampaign(campaignId: string, update: CampaignUpdate, scopeUserId = ""): Promise<void> {
  const { token } = await requireMetaConfig(scopeUserId);
  const body = new URLSearchParams({ access_token: token });
  if (update.dailyBudgetMinorUnits !== undefined) {
    body.set("daily_budget", String(Math.round(update.dailyBudgetMinorUnits)));
  }
  if (update.status) body.set("status", update.status);

  const res = await fetch(`${GRAPH}/${campaignId}`, { method: "POST", body });
  const json = (await res.json()) as { success?: boolean; error?: { message?: string } };
  if (!res.ok || json.error) throw metaError(json, res);
}
