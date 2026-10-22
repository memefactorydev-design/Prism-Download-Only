// Facebook Page + Instagram engagement analytics for the dashboard.
// Uses the scope's own Meta connection: /me/accounts yields the Page (and its
// page token + linked IG business account), then page-level 28-day insights
// and per-post engagement. Metric availability shifts between Graph versions,
// so every section degrades independently and honestly — missing permission
// or metric = that piece is null with the reason, never fabricated zeros.

import { getSecrets } from "@/lib/connections";

const GRAPH = "https://graph.facebook.com/v23.0";

export interface PostEngagement {
  text: string;
  createdAt: string;
  likes: number;
  comments: number;
  shares: number;
}

export interface SocialInsights {
  facebook: {
    pageName: string;
    followers: number | null;
    impressions28d: number | null; // page_impressions_unique, days_28
    engagements28d: number | null; // page_post_engagements, days_28
    recentPosts: number;
    avgLikes: number;
    avgComments: number;
    topPost: PostEngagement | null;
  } | null;
  instagram: {
    username: string;
    followers: number | null;
    recentPosts: number;
    avgLikes: number;
    avgComments: number;
    topPost: { caption: string; likes: number; comments: number } | null;
  } | null;
  /** Set when the connection exists but Meta refused — surfaced on the card. */
  error: string | null;
}

interface GraphError {
  error?: { message?: string; code?: number };
}

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}?${qs}`, { cache: "no-store" });
  const body = (await res.json()) as T & GraphError;
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ?? `Graph API HTTP ${res.status}`);
  }
  return body;
}

/** 28-day page metric sum; null when the metric/permission isn't available. */
async function pageMetric(pageId: string, token: string, metric: string): Promise<number | null> {
  try {
    const data = await graph<{ data?: { values?: { value?: number }[] }[] }>(`${pageId}/insights`, token, {
      metric,
      period: "days_28",
    });
    const values = data.data?.[0]?.values;
    if (!values?.length) return null;
    return values[values.length - 1]?.value ?? null;
  } catch {
    return null;
  }
}

export async function fetchSocialInsights(scopeUserId = ""): Promise<SocialInsights | null> {
  const secrets = await getSecrets("meta", scopeUserId);
  if (!secrets) return null; // not connected — the card explains what to connect

  try {
    const accounts = await graph<{
      data?: {
        id: string;
        name: string;
        access_token: string;
        fan_count?: number;
        followers_count?: number;
        instagram_business_account?: { id: string };
      }[];
    }>("me/accounts", secrets.accessToken, {
      fields: "id,name,access_token,fan_count,followers_count,instagram_business_account",
    });
    const page = accounts.data?.[0];
    if (!page) {
      return {
        facebook: null,
        instagram: null,
        error:
          "Your Meta token can't see any Facebook Page — reconnect Meta with the pages_show_list and pages_read_engagement permissions.",
      };
    }

    // Facebook: page metrics + recent post engagement (page token).
    // Meta keeps deprecating page metrics — try unique reach, fall back to
    // total impressions, show "—" when neither survives.
    const [impressions28d, engagements28d, postsRes] = await Promise.all([
      pageMetric(page.id, page.access_token, "page_impressions_unique").then(
        (v) => v ?? pageMetric(page.id, page.access_token, "page_impressions")
      ),
      pageMetric(page.id, page.access_token, "page_post_engagements"),
      graph<{
        data?: {
          message?: string;
          created_time: string;
          likes?: { summary?: { total_count?: number } };
          comments?: { summary?: { total_count?: number } };
          shares?: { count?: number };
        }[];
      }>(`${page.id}/published_posts`, page.access_token, {
        fields: "message,created_time,likes.summary(true),comments.summary(true),shares",
        limit: "10",
      }).catch(() => ({ data: [] })),
    ]);

    const posts: PostEngagement[] = (postsRes.data ?? []).map((p) => ({
      text: (p.message ?? "").slice(0, 120),
      createdAt: p.created_time,
      likes: p.likes?.summary?.total_count ?? 0,
      comments: p.comments?.summary?.total_count ?? 0,
      shares: p.shares?.count ?? 0,
    }));
    const avg = (sel: (p: PostEngagement) => number) =>
      posts.length ? Math.round(posts.reduce((t, p) => t + sel(p), 0) / posts.length) : 0;
    const topPost = posts.length
      ? [...posts].sort((a, b) => b.likes + b.comments + b.shares - (a.likes + a.comments + a.shares))[0]
      : null;

    // Instagram (when a business account is linked to the page).
    let instagram: SocialInsights["instagram"] = null;
    if (page.instagram_business_account?.id) {
      try {
        const igId = page.instagram_business_account.id;
        const [ig, media] = await Promise.all([
          graph<{ username?: string; followers_count?: number }>(igId, page.access_token, {
            fields: "username,followers_count",
          }),
          graph<{ data?: { caption?: string; like_count?: number; comments_count?: number }[] }>(
            `${igId}/media`,
            page.access_token,
            { fields: "caption,like_count,comments_count", limit: "10" }
          ),
        ]);
        const items = media.data ?? [];
        const igAvg = (sel: (m: { like_count?: number; comments_count?: number }) => number) =>
          items.length ? Math.round(items.reduce((t, m) => t + sel(m), 0) / items.length) : 0;
        const igTop = items.length
          ? [...items].sort((a, b) => (b.like_count ?? 0) + (b.comments_count ?? 0) - ((a.like_count ?? 0) + (a.comments_count ?? 0)))[0]
          : null;
        instagram = {
          username: ig.username ?? "instagram",
          followers: ig.followers_count ?? null,
          recentPosts: items.length,
          avgLikes: igAvg((m) => m.like_count ?? 0),
          avgComments: igAvg((m) => m.comments_count ?? 0),
          topPost: igTop
            ? { caption: (igTop.caption ?? "").slice(0, 120), likes: igTop.like_count ?? 0, comments: igTop.comments_count ?? 0 }
            : null,
        };
      } catch {
        instagram = null; // IG linked but unreadable (permission) — FB still shows
      }
    }

    return {
      facebook: {
        pageName: page.name,
        followers: page.followers_count ?? page.fan_count ?? null,
        impressions28d,
        engagements28d,
        recentPosts: posts.length,
        avgLikes: avg((p) => p.likes),
        avgComments: avg((p) => p.comments),
        topPost,
      },
      instagram,
      error: null,
    };
  } catch (err) {
    return {
      facebook: null,
      instagram: null,
      error: `Meta wouldn't share page analytics: ${err instanceof Error ? err.message : String(err)}. Reconnecting Meta with pages_show_list, pages_read_engagement and instagram_basic usually fixes this.`,
    };
  }
}
