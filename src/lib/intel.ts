// Platform intel for the named agents — ported intact from the original suite.
// Each "source" pairs an Apify actor with the agent who owns it:
//   fb-ads        → Scout   — Facebook Ad Library (competitor ads actually running)
//   instagram     → Isla    — top-performing posts/reels for the brand's hashtags
//   gmaps-reviews → Magnus  — Google Maps reviews (yours and competitors')
//   pinterest     → Pia     — what's pinning right now in the brand's niche
//   youtube       → Yara    — what ranks on YouTube for the brand's searches
//   tiktok        → Kai     — TikTok deep dive: hashtags + competitor profiles
//   linkedin      → Lydia   — best-performing posts for trade keywords on LinkedIn
//   viral         → Nova    — multi-channel sweep (TikTok + Instagram + YouTube +
//                             Pinterest in parallel, one merged brief)
//   houzz         → Harriet — Houzz editorial stories + homeowner discussions
//   serp          → Otto    — live UK Google results, PAA questions
//
// A run calls the actor synchronously, then the LLM distils the raw items into a
// compact markdown brief. Briefs are cached in data/intel/<source>.json for a
// week, journalled into the owning agent's dream cycle, and injectable into chat.
// This is separate from src/lib/apify.ts (Studio trend research) by design: that
// feeds the video planners; this feeds the named agents.

import fs from "node:fs";
import type { BrandProfile } from "@prisma/client";
import { brandTaskSuffix, getBrandProfile } from "@/lib/brand-profile";
import path from "node:path";
import { generate } from "@/lib/engine";
import { journal } from "@/lib/memory";
import { runApifyActor } from "@/lib/scrape";

const INTEL_DIR = path.join(process.cwd(), "data", "intel");
const FRESH_MS = 7 * 24 * 3600 * 1000; // briefs older than a week aren't injected

const csv = (s: unknown): string[] =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

// ─── sources ─────────────────────────────────────────────────────────────────

export interface IntelParam {
  key: string;
  label: string;
  default: string;
}

interface ChannelDef {
  platform: string;
  actor: string;
  buildInput: (params: Record<string, string>, max: number) => Record<string, unknown>;
}

interface SourceDef {
  agent: string;
  label: string;
  what: string;
  actor: string;
  params: IntelParam[];
  buildInput?: (params: Record<string, string>) => Record<string, unknown>;
  channels?: ChannelDef[];
}

/** Blank search inputs take their value from the workspace brand: keywords,
 *  hashtags, or what the business sells. A niche is never baked into code. */
export function fillIntelDefaults(params: Record<string, string>, profile: BrandProfile | null): Record<string, string> {
  const out = { ...params };
  const keywords = (profile?.keywords ?? "")
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const what = (profile?.whatYouSell ?? "").split(/[.;\n]/)[0].trim().slice(0, 60);
  const term = keywords[0] ?? what;
  const hashtags = (profile?.hashtags ?? "")
    .split(/[,\s#]+/)
    .map((h) => h.trim())
    .filter(Boolean);
  const tagList = (hashtags.length ? hashtags : keywords.map((k) => k.replace(/[^a-z0-9]/gi, "").toLowerCase()).filter(Boolean)).slice(0, 5);
  for (const key of ["query", "search", "topic", "keywords", "queries"]) {
    if (key in out && !out[key]?.trim() && term) out[key] = key === "queries" ? keywords.slice(0, 3).join(", ") || term : term;
  }
  if ("hashtags" in out && !out.hashtags?.trim() && tagList.length) out.hashtags = tagList.join(", ");
  return out;
}

export const SOURCES: Record<string, SourceDef> = {
  "fb-ads": {
    agent: "scout",
    label: "Facebook Ad Library",
    what: "Competitor ads actually running in the UK — copy, formats and how long they have survived (long-running = working).",
    actor: "apify/facebook-ads-scraper",
    params: [
      { key: "query", label: "Search term (your niche), or a Facebook page URL", default: "" },
      { key: "limit", label: "Max ads", default: "30" },
    ],
    buildInput: (p) => ({
      startUrls: [
        {
          url: /^https?:/i.test(p.query)
            ? p.query
            : `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=GB&q=${encodeURIComponent(p.query)}&search_type=keyword_unordered&media_type=all`,
        },
      ],
      resultsLimit: Math.min(Number.parseInt(p.limit, 10) || 30, 100),
    }),
  },
  instagram: {
    agent: "isla",
    label: "Instagram top performers",
    what: "The top-performing recent posts and reels for your niche's hashtags — what is actually earning engagement right now, whoever posted it.",
    actor: "apify/instagram-hashtag-scraper",
    params: [
      {
        key: "hashtags",
        label: "Hashtags (comma-separated, no #)",
        default: "",
      },
      { key: "limit", label: "Max posts per hashtag", default: "20" },
    ],
    buildInput: (p) => {
      const hashtags = csv(p.hashtags).map((h) => h.replace(/^#/, ""));
      if (!hashtags.length) throw new Error("Give Isla at least one hashtag to study.");
      return { hashtags, resultsLimit: Math.min(Number.parseInt(p.limit, 10) || 20, 50) };
    },
  },
  "gmaps-reviews": {
    agent: "magnus",
    label: "Google Maps reviews",
    what: "Reviews for your locations and competitors — what customers praise, what they complain about, reply gaps.",
    actor: "compass/google-maps-reviews-scraper",
    params: [
      { key: "urls", label: "Google Maps place URLs (comma-separated — yours + competitors)", default: "" },
      { key: "limit", label: "Max reviews per place", default: "25" },
    ],
    buildInput: (p) => {
      const urls = csv(p.urls);
      if (!urls.length) {
        throw new Error(
          "Paste at least one Google Maps place URL (open the business on Google Maps and copy the link)."
        );
      }
      return {
        startUrls: urls.map((url) => ({ url })),
        maxReviews: Math.min(Number.parseInt(p.limit, 10) || 25, 100),
        language: "en",
        reviewsSort: "newest",
      };
    },
  },
  pinterest: {
    agent: "pia",
    label: "Pinterest niche pulse",
    what: "What is actually pinning for your niche right now — titles, descriptions and formats to model.",
    actor: "fatihtahta/pinterest-scraper-search",
    params: [
      { key: "search", label: "Search term (your niche)", default: "" },
      { key: "limit", label: "Max pins", default: "40" },
    ],
    buildInput: (p) => ({
      queries: [p.search],
      type: "all-pins",
      limit: Math.min(Number.parseInt(p.limit, 10) || 40, 100),
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    }),
  },
  youtube: {
    agent: "yara",
    label: "YouTube niche search",
    what: "What ranks on YouTube for your niche — titles, view counts and channels to study, or a competitor channel URL.",
    actor: "streamers/youtube-scraper",
    params: [
      { key: "query", label: "Search term (your niche), or a channel URL", default: "" },
      { key: "limit", label: "Max videos", default: "20" },
    ],
    buildInput: (p) => {
      const max = Math.min(Number.parseInt(p.limit, 10) || 20, 50);
      return /^https?:/i.test(p.query)
        ? { startUrls: [{ url: p.query }], maxResults: max }
        : { searchQueries: [p.query], maxResults: max };
    },
  },
  tiktok: {
    agent: "kai",
    label: "TikTok deep dive",
    what: "Kai's own lens on TikTok — hashtag performance plus specific competitor/creator profiles, deeper than Nova's cross-platform sweep.",
    actor: "clockworks/tiktok-scraper",
    params: [
      { key: "hashtags", label: "Hashtags (comma-separated, no #)", default: "" },
      { key: "profiles", label: "Profiles to study (comma-separated usernames, optional)", default: "" },
      { key: "limit", label: "Max videos per hashtag/profile", default: "20" },
    ],
    buildInput: (p) => {
      const max = Math.min(Number.parseInt(p.limit, 10) || 20, 50);
      const input: Record<string, unknown> = { resultsPerPage: max };
      if (csv(p.hashtags).length) input.hashtags = csv(p.hashtags).map((h) => h.replace(/^#/, ""));
      if (csv(p.profiles).length) input.profiles = csv(p.profiles).map((u) => u.replace(/^@/, ""));
      if (!input.hashtags && !input.profiles) throw new Error("Give Kai at least one hashtag or profile to study.");
      return input;
    },
  },
  linkedin: {
    agent: "lydia",
    label: "LinkedIn trade pulse",
    what: "The best-performing recent LinkedIn posts for your keywords — the hooks, formats and angles landing with your professional audience, whoever wrote them.",
    actor: "harvestapi/linkedin-post-search",
    params: [
      {
        key: "keywords",
        label: "Search keywords (comma-separated)",
        default: "",
      },
      { key: "limit", label: "Max posts per keyword", default: "15" },
    ],
    buildInput: (p) => {
      const searchQueries = csv(p.keywords);
      if (!searchQueries.length) throw new Error("Give Lydia at least one search keyword.");
      return {
        searchQueries,
        maxPosts: Math.min(Number.parseInt(p.limit, 10) || 15, 50),
        sortBy: "relevance", // LinkedIn's "top" ranking — engagement-weighted
        postedLimit: "month", // recent, so the pulse is live rather than evergreen
        scrapeReactions: false,
        scrapeComments: false,
      };
    },
  },
  viral: {
    agent: "nova",
    label: "Viral pulse — all channels",
    what: "One sweep across TikTok, Instagram, YouTube and Pinterest — what is going viral in your niche on every channel, merged into a single cross-platform brief.",
    actor: "tiktok + instagram + youtube + pinterest",
    params: [
      { key: "hashtags", label: "Hashtags for TikTok & Instagram (comma-separated, no #)", default: "" },
      { key: "topic", label: "Search phrase for YouTube & Pinterest", default: "" },
      { key: "limit", label: "Max items per channel", default: "15" },
    ],
    channels: [
      {
        platform: "tiktok",
        actor: "clockworks/tiktok-scraper",
        buildInput: (p, max) => ({
          hashtags: csv(p.hashtags).map((h) => h.replace(/^#/, "")),
          resultsPerPage: max,
        }),
      },
      {
        platform: "instagram",
        actor: "apify/instagram-hashtag-scraper",
        buildInput: (p, max) => ({
          hashtags: csv(p.hashtags).map((h) => h.replace(/^#/, "")),
          resultsLimit: max,
        }),
      },
      {
        platform: "youtube",
        actor: "streamers/youtube-scraper",
        buildInput: (p, max) => ({ searchQueries: [p.topic], maxResults: max }),
      },
      {
        platform: "pinterest",
        actor: "fatihtahta/pinterest-scraper-search",
        buildInput: (p, max) => ({
          queries: [p.topic],
          type: "all-pins",
          limit: max,
          proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
        }),
      },
    ],
  },
  houzz: {
    agent: "harriet",
    label: "Houzz pulse",
    what: "What's live on Houzz for your search — the editorial stories readers browse and the questions they're actually asking. Feeds Harriet's advice-led Houzz presence.",
    actor: "fatihtahta/houzz-scraper (stories + discussions)",
    params: [
      { key: "query", label: "Search term (your niche)", default: "" },
      { key: "limit", label: "Max items per type", default: "15" },
    ],
    channels: [
      {
        platform: "stories",
        actor: "fatihtahta/houzz-scraper",
        buildInput: (p, max) => ({ queries: [p.query], queryType: "stories", limit: max }),
      },
      {
        platform: "discussions",
        actor: "fatihtahta/houzz-scraper",
        buildInput: (p, max) => ({ queries: [p.query], queryType: "discussions", limit: max }),
      },
    ],
  },
  serp: {
    agent: "otto",
    label: "Google SERP analysis",
    what: "Real UK Google results for target keywords — who ranks, their titles/descriptions, People Also Ask questions and related searches.",
    actor: "apify/google-search-scraper",
    params: [
      {
        key: "queries",
        label: "Keywords (comma-separated)",
        default: "",
      },
    ],
    buildInput: (p) => ({
      queries: csv(p.queries).join("\n"),
      countryCode: "gb",
      resultsPerPage: 20,
      maxPagesPerQuery: 1,
    }),
  },
};

// ─── cache ───────────────────────────────────────────────────────────────────

export interface IntelRecord {
  sourceId: string;
  fetchedAt: string;
  itemCount: number;
  params: Record<string, string>;
  brief: string;
  sample: unknown[];
  failures: string[];
}

function cacheFile(sourceId: string): string {
  return path.join(INTEL_DIR, `${sourceId}.json`);
}

export function readIntelCache(sourceId: string): IntelRecord | null {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(sourceId), "utf8")) as IntelRecord;
  } catch {
    return null;
  }
}

export interface IntelSourceStatus {
  id: string;
  agent: string;
  label: string;
  what: string;
  actor: string;
  params: (IntelParam & { value: string })[];
  cache: { fetchedAt: string; itemCount: number; brief: string } | null;
}

/** Source list + cache metadata + last-used params for the UI. */
export function intelStatus(): IntelSourceStatus[] {
  return Object.entries(SOURCES).map(([id, s]) => {
    const cache = readIntelCache(id);
    return {
      id,
      agent: s.agent,
      label: s.label,
      what: s.what,
      actor: s.actor,
      params: s.params.map((p) => ({ ...p, value: cache?.params?.[p.key] ?? p.default })),
      cache: cache ? { fetchedAt: cache.fetchedAt, itemCount: cache.itemCount, brief: cache.brief } : null,
    };
  });
}

/** Fresh cached briefs owned by the given agents — injected into prompts. */
export function briefsFor(agentIds: string[]): string {
  const out: string[] = [];
  for (const [id, s] of Object.entries(SOURCES)) {
    if (!agentIds.includes(s.agent)) continue;
    const cache = readIntelCache(id);
    if (!cache?.brief) continue;
    if (Date.now() - new Date(cache.fetchedAt).getTime() > FRESH_MS) continue;
    out.push(`## ${s.label} (scraped ${cache.fetchedAt.slice(0, 10)}, ${cache.itemCount} items)\n${cache.brief}`);
  }
  return out.length
    ? `# Live platform intelligence\nReal scraped data, not search results — treat these numbers and quotes as ground truth.\n\n${out.join("\n\n")}`
    : "";
}

// ─── running ─────────────────────────────────────────────────────────────────

/**
 * Serialize items into a char budget with an equal slice per item, so one huge
 * item (e.g. an Instagram profile with its full posts array) can't crowd every
 * other item out of the LLM's view.
 */
function packItems(items: unknown[], budget: number): string {
  const per = Math.max(600, Math.floor(budget / items.length));
  const parts: string[] = [];
  let used = 0;
  for (const item of items) {
    if (used >= budget) break;
    const s = JSON.stringify(item).slice(0, per);
    parts.push(s);
    used += s.length;
  }
  return parts.join("\n");
}

// Actor invocation lives in the shared runner (src/lib/scrape.ts) — one place
// owns how Apify is called across intel, trend research and templates.
const runActorSync = (actor: string, input: Record<string, unknown>) =>
  runApifyActor(actor, input, { timeoutSec: 180 });

/**
 * Run a source's actor(s), distil the items into a brief, cache and journal it.
 * Multi-channel sources run their actors in parallel and tolerate partial failure.
 */
export async function runIntel(sourceId: string, rawParams: Record<string, string>): Promise<IntelRecord> {
  const source = SOURCES[sourceId];
  if (!source) throw new Error(`Unknown intel source: ${sourceId}`);
  // Intel feeds the workspace agents, so it is briefed on the workspace brand;
  // blank search inputs are filled from that brand rather than a built-in niche.
  const profile = await getBrandProfile("");
  const businessName = profile?.businessName ?? "the business this workspace is being set up for";
  const params = fillIntelDefaults(rawParams, profile);

  let raw: string;
  let itemCount: number;
  let sample: unknown[];
  const failures: string[] = [];

  if (source.channels) {
    const max = Math.min(Number.parseInt(params.limit, 10) || 15, 40);
    const results = await Promise.allSettled(
      source.channels.map((c) => runActorSync(c.actor, c.buildInput(params, max)))
    );
    const perBudget = Math.floor(26_000 / source.channels.length);
    const parts: string[] = [];
    sample = [];
    itemCount = 0;
    results.forEach((r, i) => {
      const c = source.channels![i];
      if (r.status === "fulfilled" && r.value.length) {
        itemCount += r.value.length;
        parts.push(`=== ${c.platform.toUpperCase()} (${r.value.length} items) ===\n${packItems(r.value, perBudget)}`);
        sample.push({ platform: c.platform, item: r.value[0] });
      } else {
        failures.push(`${c.platform}: ${r.status === "rejected" ? (r.reason as Error).message : "no items returned"}`);
      }
    });
    if (!itemCount) throw new Error(`All channels failed — ${failures.join(" · ")}`);
    raw = parts.join("\n\n");
  } else {
    const items = await runActorSync(source.actor, source.buildInput!(params));
    if (!items.length) {
      throw new Error("The actor returned no items — check the inputs (and that your Apify account has credit).");
    }
    itemCount = items.length;
    raw = packItems(items, 28_000);
    sample = items.slice(0, 3);
  }

  const multiNote = source.channels
    ? " The data spans several platforms — sections are marked === PLATFORM ===. Compare across them: call out per-platform patterns AND the formats/hooks that are working everywhere (those are the true viral signals worth remixing)."
    : "";
  const { text: brief } = await generate({
    system: `You are the platform-intelligence analyst for ${businessName}. You turn raw scraped data into briefs for ${source.agent}, the team's ${source.label} specialist.${await brandTaskSuffix("")}`,
    messages: [
      {
        role: "user",
        content: `Below is raw JSON scraped from ${source.label} (${itemCount} items, may be truncated).${multiNote} Write a compact intelligence brief in markdown:

1. **Patterns** — recurring hooks, angles, formats, themes (or for reviews: recurring praise and complaints)
2. **Standouts** — the 3-5 most notable items with concrete numbers (engagement, star ratings, follower counts, ad longevity) and short verbatim quotes
3. **Takeaways** — 5 specific, actionable moves for the brand

Under ${source.channels ? 650 : 500} words, UK English, only facts present in the data — never invent numbers.

RAW DATA:\n${raw}`,
      },
    ],
  });

  const record: IntelRecord = {
    sourceId,
    fetchedAt: new Date().toISOString(),
    itemCount,
    params,
    brief,
    sample,
    failures,
  };
  fs.mkdirSync(INTEL_DIR, { recursive: true });
  fs.writeFileSync(cacheFile(sourceId), JSON.stringify(record, null, 2));

  journal(source.agent, { kind: "intel", source: source.label, itemCount, excerpt: brief });
  return record;
}
