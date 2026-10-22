// Google data via Apify — SERP (organic results) and Google Maps (local pack /
// GBP listings) for SEO/GEO and GBP research. Configurable actors; returns
// { items, error? } and never hard-throws for a missing/failed actor, so the
// agents can still fall back to their web_search tool. Public metadata only.

import { getSecrets } from "@/lib/connections";

const SEARCH_ACTOR = (process.env.APIFY_GOOGLE_SEARCH_ACTOR || "apify/google-search-scraper").replace("/", "~");
const MAPS_ACTOR = (process.env.APIFY_GMAPS_ACTOR || "compass/crawler-google-places").replace("/", "~");

export interface SerpResult {
  title?: string;
  url?: string;
  description?: string;
  position?: number;
}
export interface MapsPlace {
  title?: string;
  category?: string;
  rating?: number;
  reviews?: number;
  address?: string;
  url?: string;
  phone?: string;
}

async function runActor(actorId: string, input: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const secrets = await getSecrets("apify");
  if (!secrets) throw new Error("Apify is not connected — connect it to scrape Google data.");
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(secrets.apiToken)}&timeout=180&memory=1024`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 190_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (res.status === 404) throw new Error(`Apify actor "${actorId}" not found — set the matching APIFY_*_ACTOR env var.`);
    if (!res.ok) throw new Error(`Apify actor run failed (HTTP ${res.status}).`);
    const items = (await res.json()) as Record<string, unknown>[];
    return Array.isArray(items) ? items : [];
  } finally {
    clearTimeout(timer);
  }
}

const s = (v: unknown) => (typeof v === "string" ? v : undefined);
const n = (v: unknown) => (typeof v === "number" ? v : undefined);

/** Top organic Google results for a query. */
export async function googleSearch(query: string, count = 10): Promise<{ items: SerpResult[]; error?: string }> {
  try {
    const raw = await runActor(SEARCH_ACTOR, { queries: query, resultsPerPage: count, maxPagesPerQuery: 1, countryCode: "gb" });
    const results: SerpResult[] = [];
    for (const row of raw) {
      const organic = (row.organicResults ?? row.results) as Record<string, unknown>[] | undefined;
      if (Array.isArray(organic)) {
        for (const o of organic) {
          results.push({ title: s(o.title), url: s(o.url), description: s(o.description) ?? s(o.snippet), position: n(o.position) });
        }
      }
    }
    return { items: results.slice(0, count) };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Google Maps / local listings for a query (for GBP + local SEO research), via
 * compass/crawler-google-places. `location` maps to the actor's locationQuery.
 */
export async function googleMaps(query: string, count = 10, location?: string): Promise<{ items: MapsPlace[]; error?: string }> {
  try {
    const input: Record<string, unknown> = {
      searchStringsArray: [query],
      maxCrawledPlacesPerSearch: count,
      language: "en",
      countryCode: "gb",
    };
    if (location?.trim()) input.locationQuery = location.trim();
    const raw = await runActor(MAPS_ACTOR, input);
    const places: MapsPlace[] = raw.map((p) => ({
      title: s(p.title) ?? s(p.name),
      category: s(p.categoryName) ?? s(p.category),
      rating: n(p.totalScore) ?? n(p.rating),
      reviews: n(p.reviewsCount) ?? n(p.reviews),
      address: s(p.address),
      url: s(p.url) ?? s(p.website),
      phone: s(p.phone) ?? s(p.phoneNumber),
    }));
    return { items: places.slice(0, count) };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : String(err) };
  }
}
