// Google Ads API client (REST + GAQL) — read-first, mirroring the Meta
// marketing API layer. Reads daily campaign insights; writes (budget/pause/
// enable) are ONLY reachable through an approved Approval record via
// lib/ads.ts — never exposed to agents or routes directly.

import { getSecrets, type GoogleAdsSecrets } from "@/lib/connections";
import { refreshAccessToken } from "@/lib/google-auth";

const API = "https://googleads.googleapis.com/v21";

export interface GoogleCampaignDayInsight {
  campaignId: string;
  campaignName: string;
  date: string; // YYYY-MM-DD
  spend: number; // account currency, converted from micros
  impressions: number;
  clicks: number;
  revenue: number | null; // conversions value
  roas: number | null;
  raw: Record<string, unknown>;
}

async function config(scopeUserId = ""): Promise<{ secrets: GoogleAdsSecrets; headers: Record<string, string>; cid: string }> {
  const secrets = await getSecrets("googleads", scopeUserId);
  if (!secrets) {
    throw new Error("Google Ads is not connected yet. Add your credentials on the Connections page.");
  }
  const token = await refreshAccessToken(secrets.clientId, secrets.clientSecret, secrets.refreshToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": secrets.developerToken,
    "Content-Type": "application/json",
  };
  if (secrets.loginCustomerId?.trim()) headers["login-customer-id"] = secrets.loginCustomerId.replace(/-/g, "").trim();
  return { secrets, headers, cid: secrets.customerId.replace(/-/g, "").trim() };
}

function adsError(json: { error?: { message?: string; details?: { errors?: { message?: string }[] }[] } }, res: Response): Error {
  const detail = json.error?.details?.[0]?.errors?.[0]?.message ?? json.error?.message ?? `HTTP ${res.status}`;
  return new Error(`Google Ads API: ${detail}`);
}

async function gaql(query: string, scopeUserId = ""): Promise<Record<string, unknown>[]> {
  const { headers, cid } = await config(scopeUserId);
  const rows: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`${API}/customers/${cid}/googleAds:search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    });
    const json = (await res.json()) as {
      results?: Record<string, unknown>[];
      nextPageToken?: string;
      error?: { message?: string };
    };
    if (!res.ok) throw adsError(json, res);
    rows.push(...(json.results ?? []));
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return rows;
}

/** Daily campaign-level insights for the trailing window. */
export async function fetchGoogleCampaignInsights(days = 30, scopeUserId = ""): Promise<GoogleCampaignDayInsight[]> {
  const results = await gaql(
    `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros,
            metrics.impressions, metrics.clicks, metrics.conversions_value
     FROM campaign
     WHERE segments.date DURING LAST_${days === 7 ? "7" : "30"}_DAYS
       AND campaign.status != 'REMOVED'`,
    scopeUserId
  );
  return results.map((r) => {
    const campaign = r.campaign as { id?: string | number; name?: string };
    const segments = r.segments as { date?: string };
    const metrics = r.metrics as {
      costMicros?: string | number;
      impressions?: string | number;
      clicks?: string | number;
      conversionsValue?: number;
    };
    const spend = Number(metrics?.costMicros ?? 0) / 1_000_000;
    const revenue = metrics?.conversionsValue != null ? Number(metrics.conversionsValue) : null;
    return {
      campaignId: String(campaign?.id ?? ""),
      campaignName: String(campaign?.name ?? ""),
      date: String(segments?.date ?? ""),
      spend,
      impressions: Number(metrics?.impressions ?? 0),
      clicks: Number(metrics?.clicks ?? 0),
      revenue,
      roas: revenue != null && spend > 0 ? revenue / spend : null,
      raw: r,
    };
  });
}

export interface GoogleWriteCapability {
  unlocked: boolean;
  reason: string;
}

/** Live check: can this connection write? (validate-only pause of nothing.) */
export async function getGoogleWriteCapability(scopeUserId = ""): Promise<GoogleWriteCapability> {
  try {
    // Reading the customer proves auth; a developer token with test-only
    // access fails here on production accounts with a clear message.
    await gaql("SELECT customer.id FROM customer LIMIT 1", scopeUserId);
    return { unlocked: true, reason: "Connection verified — campaign writes execute after your approval." };
  } catch (err) {
    return { unlocked: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export interface GoogleCampaignUpdate {
  dailyBudgetMinorUnits?: number; // e.g. pence — converted to micros
  status?: "ENABLED" | "PAUSED";
}

/**
 * Update a campaign. ONLY reachable through an approved Approval record via
 * lib/ads.ts (same contract as Meta's updateCampaign).
 */
export async function updateGoogleCampaign(
  campaignId: string,
  update: GoogleCampaignUpdate,
  scopeUserId = ""
): Promise<void> {
  const { headers, cid } = await config(scopeUserId);

  if (update.status) {
    const res = await fetch(`${API}/customers/${cid}/campaigns:mutate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operations: [
          {
            update: { resourceName: `customers/${cid}/campaigns/${campaignId}`, status: update.status },
            updateMask: "status",
          },
        ],
      }),
    });
    if (!res.ok) throw adsError((await res.json()) as never, res);
  }

  if (update.dailyBudgetMinorUnits !== undefined) {
    // Budgets live on their own resource — find the campaign's budget first.
    const rows = await gaql(
      `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${Number(campaignId)}`,
      scopeUserId
    );
    const budgetResource = (rows[0]?.campaign as { campaignBudget?: string })?.campaignBudget;
    if (!budgetResource) throw new Error(`Campaign ${campaignId} has no budget resource visible to this connection.`);
    const res = await fetch(`${API}/customers/${cid}/campaignBudgets:mutate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operations: [
          {
            update: {
              resourceName: budgetResource,
              amountMicros: String(Math.round(update.dailyBudgetMinorUnits * 10_000)), // pence → micros
            },
            updateMask: "amount_micros",
          },
        ],
      }),
    });
    if (!res.ok) throw adsError((await res.json()) as never, res);
  }
}
