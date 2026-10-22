// Turn a cached intel brief into a calendar draft: channel-copy-agent distils
// the brief's strongest takeaway into ONE post for the source's natural channel,
// which lands as a normal draft behind the usual approval gate.

import { runAgent } from "@/lib/agents/run-agent";
import { readIntelCache, SOURCES } from "@/lib/intel";
import { CHANNELS, CHANNEL_SPECS, clampCaption, createDraft, resolveFormat } from "@/lib/posts";
import { getSessionUser, scopeOf } from "@/lib/auth";
import type { Channel } from "@/lib/postiz";

export const maxDuration = 120;

// Each intel source's natural posting channel. Houzz is absent on purpose —
// there is no Houzz posting channel (no API/Postiz support); Harriet's brief
// feeds chat and dreams instead.
const SOURCE_CHANNEL: Record<string, Channel> = {
  "fb-ads": "facebook",
  instagram: "instagram",
  "gmaps-reviews": "gbp",
  pinterest: "pinterest",
  youtube: "youtube",
  tiktok: "tiktok",
  linkedin: "linkedin",
  viral: "instagram",
  serp: "gbp",
};

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string", description: "The channel-ready caption/description, with NO hashtags inside it." },
    hashtags: { type: "string", description: "Space-separated #tags suited to the channel, or empty string." },
    title: {
      type: "string",
      description: "A short title (YouTube video title / Pinterest pin title), or empty string if the channel doesn't use one.",
    },
  },
  required: ["caption", "hashtags", "title"],
  additionalProperties: false,
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { channel?: string };

  const source = SOURCES[id];
  if (!source) return Response.json({ error: `Unknown intel source: ${id}` }, { status: 404 });
  const channel = (body.channel as Channel) || SOURCE_CHANNEL[id];
  if (!channel || !CHANNELS.includes(channel)) {
    return Response.json(
      { error: `${source.label} has no posting channel — use the brief in chat instead.` },
      { status: 400 }
    );
  }
  const cache = readIntelCache(id);
  if (!cache?.brief) {
    return Response.json({ error: "No cached brief for this source — run the scrape first." }, { status: 404 });
  }

  const task = [
    `Below is a live intelligence brief from ${source.label}. Draft ONE strong, ready-to-post caption for ${channel} for the brand described in the brand brief below that ACTS on the intelligence brief's strongest takeaway — apply the winning pattern to the brand's own work. Do not summarise the brief or mention competitors by name.`,
    `HARD LIMIT: the caption must be under ${CHANNEL_SPECS[channel].maxChars} characters (hashtags not included).`,
    "",
    "## Intelligence brief",
    cache.brief.slice(0, 8000),
    "",
    "Write the caption as if the matching media (video/imagery) already exists — the owner attaches it in the composer.",
  ].join("\n");

  try {
    const { data } = await runAgent<{ caption: string; hashtags: string; title: string }>(
      "channel-copy-agent",
      task,
      {
        schema: DRAFT_SCHEMA,
        maxTokens: 6000,
        reportKind: "channel_copy",
        reportTitle: `Draft from intel: ${source.label}`,
        scopeUserId: scopeOf(user),
      }
    );
    if (!data) throw new Error("channel-copy-agent returned no copy.");
    const post = await createDraft({
      channel,
      format: resolveFormat(channel, undefined),
      title: data.title?.trim() || undefined,
      body: clampCaption(channel, data.caption),
      hashtags: data.hashtags || undefined,
    }, user);
    return Response.json({ postId: post.id, channel });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
