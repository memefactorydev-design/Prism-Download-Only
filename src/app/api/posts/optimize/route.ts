// AI: rewrite a caption + hashtags optimised for one channel, using that
// platform's conventions and the niche's current trend signals. Used by the
// calendar composer's "Optimise for <channel>" button.

import { runAgent } from "@/lib/agents/run-agent";
import { relevantTrendInsights } from "@/lib/trends";
import { CHANNELS } from "@/lib/posts";
import { getSessionUser, scopeOf } from "@/lib/auth";
import type { Channel } from "@/lib/postiz";

export const maxDuration = 120;

const COPY_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string", description: "The channel-ready caption/description, with NO hashtags inside it." },
    hashtags: { type: "string", description: "Space-separated #tags suited to the channel, or empty string." },
  },
  required: ["caption", "hashtags"],
  additionalProperties: false,
};

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  const body = (await request.json().catch(() => ({}))) as {
    instruction?: string;
    body?: string;
    hashtags?: string;
    channel?: string;
    format?: string;
  };
  const channel = body.channel as Channel;
  if (!channel || !CHANNELS.includes(channel)) {
    return Response.json({ error: `Pick a valid channel (${CHANNELS.join(", ")}).` }, { status: 400 });
  }
  if (!body.body?.trim()) {
    return Response.json({ error: "Write a caption first, then optimise it." }, { status: 400 });
  }

  const trends = await relevantTrendInsights(body.body, 5, scope);
  const trendBlock = trends.length
    ? [
        "",
        "## Current trend signals for this niche (use where relevant)",
        ...trends.map((t) => `- [${t.platform}] ${t.title}: hook "${t.hook}" — ${t.format}`),
      ].join("\n")
    : "";

  const task = [
    `Rewrite this caption so it is optimised for ${channel}${body.format ? ` (${body.format})` : ""}.`,
    body.instruction?.trim() ? `The owner's note takes priority: ${body.instruction.trim().slice(0, 400)}` : "",
    "Keep the meaning and any facts; adapt tone, length, structure, emoji and hashtags to the platform.",
    "",
    "## Source caption",
    body.body.trim(),
    body.hashtags?.trim() ? `\n## Existing hashtags\n${body.hashtags.trim()}` : "",
    trendBlock,
  ].join("\n");

  try {
    const { data } = await runAgent<{ caption: string; hashtags: string }>("channel-copy-agent", task, {
      schema: COPY_SCHEMA,
      maxTokens: 6000,
      reportKind: "channel_copy",
      reportTitle: `Optimised copy for ${channel}`,
      scopeUserId: scope,
    });
    if (!data) throw new Error("channel-copy-agent returned no copy.");
    return Response.json({ caption: data.caption, hashtags: data.hashtags });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
