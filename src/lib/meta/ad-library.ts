// Meta Ad Library API — the public, ToS-compliant source for viral/competitor
// ad research used by ad-research-agent. No ad-account or spend access needed.
//
// HONESTY NOTE on coverage: the ads_archive API returns ALL ad types for EU
// countries (DSA transparency). For the UK (post-Brexit), API coverage of
// commercial ads is limited — searches may return only political/issue ads or
// an error. The research flow records this per-search instead of hiding it,
// and IE (Ireland) is included as an EU proxy for UK-relevant English-language
// category research.

import { getSecrets } from "@/lib/connections";

const GRAPH = "https://graph.facebook.com/v23.0";

export interface AdLibrarySearch {
  searchTerms: string;
  countries: string[]; // e.g. ["GB", "IE"]
  limit?: number;
}

export interface AdLibraryResult {
  id: string;
  pageName: string;
  adCreativeBodies: string[];
  adCreativeLinkTitles: string[];
  adDeliveryStartTime: string;
  adSnapshotUrl: string;
  publisherPlatforms: string[];
}

const FIELDS = [
  "id",
  "page_name",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_delivery_start_time",
  "ad_snapshot_url",
  "publisher_platforms",
].join(",");

export async function searchAdLibrary(search: AdLibrarySearch): Promise<AdLibraryResult[]> {
  const secrets = await getSecrets("meta");
  if (!secrets) {
    throw new Error("Meta is not connected yet. Add your credentials on the Connections page.");
  }

  const params = new URLSearchParams({
    search_terms: search.searchTerms,
    ad_reached_countries: JSON.stringify(search.countries),
    ad_active_status: "ACTIVE",
    ad_type: "ALL",
    fields: FIELDS,
    limit: String(search.limit ?? 25),
    access_token: secrets.accessToken,
  });

  const res = await fetch(`${GRAPH}/ads_archive?${params}`);
  const json = (await res.json()) as {
    data?: Record<string, unknown>[];
    error?: { message: string; code?: number };
  };
  if (!res.ok || json.error) {
    // Surfaced verbatim — Ad Library errors are informative (e.g. country
    // coverage limits, identity confirmation requirements).
    throw new Error(`Ad Library API: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }

  return (json.data ?? []).map((ad) => ({
    id: String(ad.id ?? ""),
    pageName: String(ad.page_name ?? ""),
    adCreativeBodies: (ad.ad_creative_bodies as string[]) ?? [],
    adCreativeLinkTitles: (ad.ad_creative_link_titles as string[]) ?? [],
    adDeliveryStartTime: String(ad.ad_delivery_start_time ?? ""),
    adSnapshotUrl: String(ad.ad_snapshot_url ?? ""),
    publisherPlatforms: (ad.publisher_platforms as string[]) ?? [],
  }));
}
