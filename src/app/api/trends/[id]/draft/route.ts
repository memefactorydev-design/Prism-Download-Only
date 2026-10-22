// Turn one TrendInsight into a calendar draft: channel-copy-agent applies the
// insight's proven pattern to the researched topic and returns channel-ready
// copy, which lands as a normal draft behind the usual approval gate.

import { runAgent } from "@/lib/agents/run-agent";
import { db } from "@/lib/db";
import { CHANNELS, CHANNEL_SPECS, clampCaption, createDraft, resolveFormat } from "@/lib/posts";
import { canTouch, getSessionUser, scopeOf } from "@/lib/auth";
import type { Channel } from "@/lib/postiz";

export const maxDuration = 120;

// Trend platforms map 1:1 onto posting channels.
const DEFAULT_CHANNEL: Record<string, Channel> = {
  tiktok: "tiktok",
  instagram: "instagram",
  youtube: "youtube",
  linkedin: "linkedin",
  pinterest: "pinterest",
  facebook: "facebook",
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

  const insight = await db.trendInsight.findUnique({ where: { id } });
  if (!insight || !canTouch(insight, user)) return Response.json({ error: "Trend insight not found." }, { status: 404 });

  const channel = (body.channel as Channel) || DEFAULT_CHANNEL[insight.platform] || "instagram";
  if (!CHANNELS.includes(channel)) {
    return Response.json({ error: `Pick a valid channel (${CHANNELS.join(", ")}).` }, { status: 400 });
  }

  const task = [
    `Turn this proven ${insight.platform} content pattern into ONE ready-to-post caption for ${channel}, applied to the topic "${insight.topic}" in the voice set out in the brand brief below (human, specific, never generic). Stay on that topic.`,
    `HARD LIMIT: the caption must be under ${CHANNEL_SPECS[channel].maxChars} characters (hashtags not included).`,
    "",
    "## The pattern",
    `Title: ${insight.title}`,
    `Hook: ${insight.hook}`,
    `Format: ${insight.format}`,
    insight.pacing ? `Pacing: ${insight.pacing}` : "",
    insight.whyItWorks ? `Why it works: ${insight.whyItWorks}` : "",
    "",
    "Write the caption as if the matching media (video/imagery) already exists — the owner attaches it in the composer.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { data } = await runAgent<{ caption: string; hashtags: string; title: string }>(
      "channel-copy-agent",
      task,
      {
        schema: DRAFT_SCHEMA,
        maxTokens: 6000,
        reportKind: "channel_copy",
        reportTitle: `Draft from trend: ${insight.title.slice(0, 60)}`,
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
