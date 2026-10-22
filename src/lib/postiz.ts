// THE single posting core.
// Every channel (instagram/facebook/tiktok/linkedin/youtube/pinterest/gbp)
// publishes through this module and nothing else — one Postiz integration,
// per-channel strategy on top. Postiz owns each platform's OAuth; we talk only
// to Postiz's public API. Credentials come from the encrypted Connection store
// (Phase 1), with .env fallback.

import { getSecrets } from "@/lib/connections";

export type Channel =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "youtube"
  | "pinterest"
  | "gbp"; // Google Business Profile (Postiz "Google My Business" provider)

// Postiz platform identifiers don't always contain our channel name verbatim
// (e.g. our "gbp" is Postiz's "gmb"/"google-my-business"), so each channel
// carries the identifier substrings that count as a match.
const PROVIDER_ALIASES: Record<Channel, string[]> = {
  instagram: ["instagram"],
  facebook: ["facebook"],
  tiktok: ["tiktok"],
  linkedin: ["linkedin"],
  youtube: ["youtube"],
  pinterest: ["pinterest"],
  gbp: ["gmb", "google-my-business", "google_my_business", "googlemybusiness", "google"],
};

export interface PostizIntegration {
  id: string;
  platform: string;
  name: string;
}

export interface PostizMediaRef {
  id: string;
  path: string;
}

export interface SchedulePostInput {
  integrationId: string;
  channel: Channel;
  format: string; // post | reel | carousel | story | short | video
  title?: string; // used by YouTube (required there)
  content: string;
  media: PostizMediaRef[];
  scheduledFor: Date;
}

// Postiz per-post settings vary by platform. Instagram/Facebook take a post_type
// of "post" (feed) or "story" — a reel is just a vertical-video feed post and a
// carousel is a multi-image feed post (Postiz/IG infer those), so only story maps
// to a distinct type. YouTube needs a title and a video type. Pinterest takes a
// pin title (the board is whichever the Postiz channel is configured with).
// Other channels take no special settings. The exact YouTube/Pinterest/GBP
// schemas are verified on first live call — a mismatch surfaces as a loud
// Postiz error rather than a silent failure.
function buildSettings(input: SchedulePostInput): Record<string, unknown> {
  switch (input.channel) {
    case "instagram":
    case "facebook":
      return { post_type: input.format === "story" ? "story" : "post" };
    case "youtube":
      return { title: input.title?.trim() || input.content.slice(0, 90), type: "video" };
    case "pinterest":
      return { title: input.title?.trim() || input.content.slice(0, 90) };
    default:
      return {};
  }
}

export interface ScheduledPost {
  postizPostId: string;
}

// Postiz is a PER-USER connection: "" is the workspace's (admin) account, any
// other value is that user's own Postiz — beta testers post to THEIR channels.
async function getBaseAndKey(scopeUserId = "") {
  const secrets = await getSecrets("postiz", scopeUserId);
  if (!secrets) {
    throw new Error("Postiz is not connected yet. Add your API key on the Connections page.");
  }
  return { base: secrets.apiUrl.replace(/\/$/, ""), apiKey: secrets.apiKey };
}

async function postizFetch(
  path: string,
  init?: RequestInit & { json?: unknown },
  scopeUserId = ""
): Promise<unknown> {
  const { base, apiKey } = await getBaseAndKey(scopeUserId);
  const res = await fetch(`${base}${path}`, {
    ...init,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    headers: {
      Authorization: apiKey,
      ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Postiz API ${res.status} on ${path}: ${await res.text()}`);
  }
  return res.json();
}

/** List the social accounts connected inside Postiz (used by the Connections page). */
export async function listIntegrations(scopeUserId = ""): Promise<PostizIntegration[]> {
  const json = await postizFetch("/integrations", undefined, scopeUserId);
  const list = Array.isArray(json)
    ? json
    : (((json as Record<string, unknown>).integrations as unknown[]) ?? []);
  return (list as Record<string, unknown>[]).map((i) => ({
    id: String(i.id ?? ""),
    platform: String(i.identifier ?? i.platform ?? "unknown"),
    name: String(i.name ?? ""),
  }));
}

/** Find the Postiz integration for one of our channels, or explain what's missing. */
export async function resolveIntegration(channel: Channel, scopeUserId = ""): Promise<PostizIntegration> {
  const integrations = await listIntegrations(scopeUserId);
  const aliases = PROVIDER_ALIASES[channel] ?? [channel];
  const match = integrations.find((i) => {
    const platform = i.platform.toLowerCase();
    return aliases.some((a) => platform.includes(a));
  });
  if (!match) {
    const connected = integrations.map((i) => i.platform).join(", ") || "none";
    throw new Error(
      `No ${channel} account is connected inside Postiz (connected: ${connected}). Open Postiz, add the ${channel} channel, then retry.`
    );
  }
  return match;
}

/** Upload a media file into Postiz so a scheduled post can reference it. */
export async function uploadMedia(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  scopeUserId = ""
): Promise<PostizMediaRef> {
  const { base, apiKey } = await getBaseAndKey(scopeUserId);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  const res = await fetch(`${base}/upload`, {
    method: "POST",
    headers: { Authorization: apiKey },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Postiz upload failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const id = String(json.id ?? "");
  const path = String(json.path ?? json.url ?? "");
  if (!id && !path) {
    throw new Error(`Postiz upload returned an unexpected shape: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { id, path };
}

/**
 * Schedule a post. Callers MUST only invoke this with an approved Post record —
 * the approval gate is enforced in lib/posts.ts, and this function is never
 * exposed to agents directly.
 */
export async function schedulePost(input: SchedulePostInput, scopeUserId = ""): Promise<ScheduledPost> {
  const json = await postizFetch("/posts", {
    method: "POST",
    json: {
      type: "schedule",
      date: input.scheduledFor.toISOString(),
      shortLink: false,
      // Postiz requires a tags array (empty is fine) at the top level.
      tags: [],
      posts: [
        {
          integration: { id: input.integrationId },
          value: [
            {
              content: input.content,
              image: input.media.map((m) => ({ id: m.id, path: m.path })),
            },
          ],
          // Per-post settings are channel-aware (see buildSettings).
          settings: buildSettings(input),
        },
      ],
    },
  }, scopeUserId);
  // Postiz returns the created post(s); extract the id defensively and loudly.
  const arr = Array.isArray(json) ? json : [json];
  const first = arr[0] as Record<string, unknown> | undefined;
  const id = first?.postId ?? first?.id;
  if (!id) {
    throw new Error(`Postiz scheduled the post but returned an unexpected shape: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { postizPostId: String(id) };
}
