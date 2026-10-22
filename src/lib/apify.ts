// Platform + input shapes for the Studio trend-research agents. Runs a scraper
// actor (via the shared runner in src/lib/scrape.ts) and returns normalised
// dataset items (public metadata only — captions, hashtags, sounds, counts,
// URLs; never downloaded video files).
//
// NOTE: this scrapes public platform data via Apify, which is subject to those
// platforms' Terms of Service — used here at the owner's explicit choice. Actor
// ids are configurable so you can point at whichever scraper you have access to.

import { runApifyActor } from "@/lib/scrape";

export type TrendPlatform = "tiktok" | "instagram" | "youtube" | "linkedin" | "pinterest" | "facebook";

// Defaults use Apify's `~` actor path form (owner~actor-name). Override via env.
const DEFAULT_ACTORS: Record<TrendPlatform, string> = {
  tiktok: "clockworks~tiktok-scraper",
  instagram: "apify~instagram-scraper",
  youtube: "streamers~youtube-scraper",
  linkedin: "harvestapi~linkedin-post-search",
  pinterest: "fatihtahta~pinterest-scraper-search",
  facebook: "apify~facebook-ads-scraper", // Ad Library — see buildInput note
};

const ACTOR_ENV: Record<TrendPlatform, string | undefined> = {
  tiktok: process.env.APIFY_TIKTOK_ACTOR,
  instagram: process.env.APIFY_INSTAGRAM_ACTOR,
  youtube: process.env.APIFY_YOUTUBE_ACTOR,
  linkedin: process.env.APIFY_LINKEDIN_ACTOR,
  pinterest: process.env.APIFY_PINTEREST_ACTOR,
  facebook: process.env.APIFY_FACEBOOK_ACTOR,
};

function actorFor(platform: TrendPlatform): string {
  return (ACTOR_ENV[platform]?.trim() || DEFAULT_ACTORS[platform]).replace("/", "~");
}

// Best-effort input per platform. Different actors expect slightly different
// fields; these cover the common scrapers and can be adjusted per actor.
function buildInput(platform: TrendPlatform, topic: string, keywords: string, count: number): Record<string, unknown> {
  const terms = [topic, ...keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean)].filter(Boolean);
  if (platform === "tiktok") {
    return { searchQueries: terms, resultsPerPage: count, shouldDownloadVideos: false, shouldDownloadCovers: false };
  }
  if (platform === "youtube") {
    return {
      searchQueries: terms,
      maxResults: count,
      maxResultsShorts: count,
      downloadSubtitles: false,
      saveSubsToKVS: false,
    };
  }
  if (platform === "linkedin") {
    // Default actor (harvestapi/linkedin-post-search) searches LinkedIn's
    // best-performing recent posts for the topic/keywords — live discovery of
    // what's working, not a fixed profile list.
    return {
      searchQueries: terms,
      maxPosts: count,
      sortBy: "relevance",
      postedLimit: "month",
      scrapeReactions: false,
      scrapeComments: false,
    };
  }
  if (platform === "pinterest") {
    return {
      queries: terms,
      type: "all-pins",
      limit: count,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    };
  }
  if (platform === "facebook") {
    // Facebook organic virality isn't reliably scrapeable; the honest signal is
    // the Ad Library — ads that keep running are ads that work. Combined with
    // Instagram insights (Meta cross-posting), that's the Facebook picture.
    return {
      startUrls: [
        {
          url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=GB&q=${encodeURIComponent(topic)}&search_type=keyword_unordered&media_type=all`,
        },
      ],
      resultsLimit: Math.min(count, 100),
    };
  }
  return { search: topic, searchType: "hashtag", resultsType: "posts", resultsLimit: count };
}

export interface ScrapedItem {
  caption?: string;
  hashtags?: string[];
  url?: string;
  author?: string;
  sound?: string;
  playCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
}

// Normalise the many field names different actors use into our compact shape.
function normalize(raw: Record<string, unknown>): ScrapedItem {
  const n = (v: unknown) => (typeof v === "number" ? v : undefined);
  const s = (v: unknown) => (typeof v === "string" ? v : undefined);
  const music = raw.musicMeta as Record<string, unknown> | undefined;
  // Some actors (e.g. harvestapi/linkedin-post-search) nest the author and
  // engagement counts in objects rather than flat fields; the Facebook Ad
  // Library scraper nests the creative under `snapshot`.
  const author = raw.author as Record<string, unknown> | undefined;
  const eng = (raw.engagement ?? raw.socialCounts ?? raw.stats) as Record<string, unknown> | undefined;
  const snapshot = raw.snapshot as Record<string, unknown> | undefined;
  const snapshotBody = snapshot?.body as Record<string, unknown> | undefined;
  return {
    // YouTube actors put the caption in `title` and the description in `text`;
    // LinkedIn actors use `text`/`content`/`postText`; Pinterest pins use
    // `title`/`description`; FB Ad Library creatives sit in `snapshot.body.text`/`adText`.
    caption:
      s(raw.text) ?? s(raw.caption) ?? s(raw.content) ?? s(raw.postText) ?? s(raw.adText) ??
      s(snapshotBody?.text) ?? s(raw.description) ?? s(raw.title),
    hashtags: Array.isArray(raw.hashtags)
      ? (raw.hashtags as unknown[]).map((h) => (typeof h === "string" ? h : (h as { name?: string })?.name ?? "")).filter(Boolean)
      : undefined,
    url: s(raw.webVideoUrl) ?? s(raw.url) ?? s(raw.postPage) ?? s(raw.postUrl) ?? s(raw.linkedinUrl),
    author:
      s(raw.authorMeta && (raw.authorMeta as { name?: string }).name) ??
      s(raw.ownerUsername) ??
      s(raw.authorName) ??
      s(raw.channelName) ??
      s(raw.channelUsername) ??
      s(raw.authorFullName) ??
      s(author?.name) ??
      s(author?.publicIdentifier) ??
      s(raw.pageName) ??
      s(snapshot?.page_name),
    sound: s(music?.musicName) ?? s(raw.musicName),
    playCount: n(raw.playCount) ?? n(raw.videoPlayCount) ?? n(raw.viewCount) ?? n(raw.numberOfViews),
    likeCount:
      n(raw.diggCount) ?? n(raw.likesCount) ?? n(raw.likeCount) ?? n(raw.likes) ?? n(raw.numLikes) ??
      n(raw.reactionsCount) ?? n(raw.reactions) ?? n(eng?.likes) ?? n(eng?.reactions),
    commentCount:
      n(raw.commentCount) ?? n(raw.commentsCount) ?? n(raw.numberOfComments) ?? n(raw.numComments) ?? n(eng?.comments),
    shareCount: n(raw.shareCount) ?? n(raw.numShares) ?? n(raw.repostsCount) ?? n(eng?.shares) ?? n(eng?.reposts),
  };
}

/** Run the platform's scraper actor and return normalised top items. */
export async function scrapeTrends(
  platform: TrendPlatform,
  topic: string,
  keywords: string,
  count = 20
): Promise<ScrapedItem[]> {
  const actorId = actorFor(platform);
  const input = buildInput(platform, topic, keywords, count);

  let items: unknown[];
  try {
    items = await runApifyActor(actorId, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("Apify 401")) throw new Error("Apify rejected the token — reconnect it on the Connections page.");
    if (msg.startsWith("Apify 404")) throw new Error(`Apify actor "${actorId}" not found — set APIFY_${platform.toUpperCase()}_ACTOR to an actor you have.`);
    if (err instanceof Error && err.name === "TimeoutError") throw new Error("The Apify scrape timed out — try a narrower topic or fewer results.");
    throw err;
  }
  if (!items.length) {
    throw new Error("Apify returned no results for that topic — try different keywords.");
  }
  return (items as Record<string, unknown>[]).slice(0, count).map(normalize);
}
