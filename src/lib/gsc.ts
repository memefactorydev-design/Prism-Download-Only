// Google Search Console client: REAL search performance for the connected
// property — the queries people actually typed, the pages that actually
// ranked. Feeds the SEO/GEO audit as hard evidence and the /seo dashboard
// panel. Service-account auth (headless), read-only scope.

import { getSecrets } from "@/lib/connections";
import { parseServiceAccount, serviceAccountToken } from "@/lib/google-auth";

export interface SearchRow {
  key: string; // query or page URL
  clicks: number;
  impressions: number;
  ctr: number; // 0-1
  position: number;
}

export interface SearchPerformance {
  siteUrl: string;
  days: number;
  totals: { clicks: number; impressions: number };
  topQueries: SearchRow[];
  topPages: SearchRow[];
}

async function gscQuery(
  siteUrl: string,
  token: string,
  body: Record<string, unknown>
): Promise<SearchRow[]> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const json = (await res.json()) as {
    rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Search Console API: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return (json.rows ?? []).map((r) => ({
    key: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}

/** Live search performance for the scope's connected GSC property. */
export async function fetchSearchPerformance(scopeUserId = "", days = 28): Promise<SearchPerformance> {
  const secrets = await getSecrets("gsc", scopeUserId);
  if (!secrets) {
    throw new Error("Google Search Console is not connected yet — add it on the Connections page.");
  }
  const sa = parseServiceAccount(secrets.serviceAccountJson);
  const token = await serviceAccountToken(sa, "https://www.googleapis.com/auth/webmasters.readonly");

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const range = { startDate: fmt(start), endDate: fmt(end) };

  const [topQueries, topPages] = await Promise.all([
    gscQuery(secrets.siteUrl, token, { ...range, dimensions: ["query"], rowLimit: 40 }),
    gscQuery(secrets.siteUrl, token, { ...range, dimensions: ["page"], rowLimit: 25 }),
  ]);

  const totals = topQueries.reduce(
    (t, r) => ({ clicks: t.clicks + r.clicks, impressions: t.impressions + r.impressions }),
    { clicks: 0, impressions: 0 }
  );
  return { siteUrl: secrets.siteUrl, days, totals, topQueries, topPages };
}

/** Markdown evidence block for the seo-geo-agent — "" when not connected. */
export async function searchPerformanceEvidence(scopeUserId = ""): Promise<string> {
  try {
    const perf = await fetchSearchPerformance(scopeUserId);
    const fmtRow = (r: SearchRow) =>
      `| ${r.key.slice(0, 80)} | ${r.clicks} | ${r.impressions} | ${(r.ctr * 100).toFixed(1)}% | ${r.position.toFixed(1)} |`;
    return [
      `## REAL search performance (Google Search Console, last ${perf.days} days, ${perf.siteUrl})`,
      "This is measured data from Google, not an estimate — ground every ranking/CTR claim in it.",
      "",
      "### Top queries",
      "| Query | Clicks | Impressions | CTR | Avg position |",
      "|---|---|---|---|---|",
      ...perf.topQueries.slice(0, 25).map(fmtRow),
      "",
      "### Top pages",
      "| Page | Clicks | Impressions | CTR | Avg position |",
      "|---|---|---|---|---|",
      ...perf.topPages.slice(0, 15).map(fmtRow),
    ].join("\n");
  } catch {
    // Not connected (or API hiccup) — the audit proceeds on scraped evidence,
    // and the /seo page tells the user how to connect for real data.
    return "";
  }
}
