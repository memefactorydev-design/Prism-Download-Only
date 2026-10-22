// P4.2 — the refraction. One idea in, native cuts out: every chosen platform
// gets its own caption, hashtags, hook and format from ONE agent pass, created
// as sibling drafts sharing a refractionGroup so Review can show them side by
// side (and what cross-posting would have sent instead).

import { randomUUID } from "node:crypto";
import { runAgent } from "@/lib/agents/run-agent";
import { createDraft, resolveFormat, splitCaptionHashtags, CHANNELS, type PostActor } from "@/lib/posts";
import type { Channel } from "@/lib/postiz";
import type { Post } from "@prisma/client";

const REFRACT_SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      description: "One variant per requested channel — each genuinely native, never the same words twice.",
      items: {
        type: "object",
        properties: {
          channel: { type: "string" },
          caption: { type: "string", description: "Platform-native caption; distinct hook, length and structure per platform." },
          hashtags: { type: "string", description: "Platform-appropriate hashtag set, space-separated ('' where hashtags don't fit the platform)." },
          title: { type: "string", description: "Title for YouTube/Pinterest; '' otherwise." },
        },
        required: ["channel", "caption", "hashtags", "title"],
        additionalProperties: false,
      },
    },
  },
  required: ["variants"],
  additionalProperties: false,
};

export interface RefractSource {
  title?: string;
  body: string;
  hashtags?: string;
  mediaIds?: string[];
  isVideo?: boolean; // vertical video source → reel/short/video formats
  scheduledFor?: string;
}

/** Create native-cut sibling drafts for each channel. Returns the created posts. */
export async function refractDraft(
  source: RefractSource,
  channels: string[],
  actor: PostActor,
  scopeUserId: string
): Promise<Post[]> {
  const valid = [...new Set(channels)].filter((c): c is Channel => CHANNELS.includes(c as Channel)).slice(0, 7);
  if (valid.length < 2) throw new Error("Refraction needs at least two channels — or create a single-channel draft instead.");

  const task = [
    `Refract ONE piece of content into ${valid.length} platform-NATIVE variants: ${valid.join(", ")}.`,
    "Each platform gets its own hook, caption length, structure and hashtag culture — a reader comparing two variants should feel they were written for that platform, never copy-pasted. Keep the core message identical.",
    source.isVideo ? "The content is a vertical short-form video — captions accompany the video." : "",
    "",
    "## Source content",
    source.title ? `Title: ${source.title}` : "",
    source.body.slice(0, 2000),
    source.hashtags ? `\nExisting hashtags: ${source.hashtags}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await runAgent<{ variants: { channel: string; caption: string; hashtags: string; title: string }[] }>(
    "channel-copy-agent",
    task,
    { schema: REFRACT_SCHEMA, maxTokens: 8000, reportKind: "channel_copy", reportTitle: "Refraction", scopeUserId }
  );
  if (!data?.variants?.length) throw new Error("The refraction returned nothing — try again.");

  const group = randomUUID();
  const posts: Post[] = [];
  for (const ch of valid) {
    const v = data.variants.find((x) => x.channel === ch) ?? data.variants[0];
    const split = splitCaptionHashtags(v.caption, v.hashtags);
    const format = source.isVideo
      ? resolveFormat(ch, ch === "youtube" ? "short" : ch === "pinterest" ? "video" : "reel")
      : resolveFormat(ch, "post");
    posts.push(
      await createDraft(
        {
          channel: ch,
          format,
          title: v.title?.trim() || source.title || undefined,
          body: split.caption || source.body,
          hashtags: split.hashtags || undefined,
          mediaIds: source.mediaIds,
          scheduledFor: source.scheduledFor,
          refractionGroup: group,
        },
        actor
      )
    );
  }
  return posts;
}
