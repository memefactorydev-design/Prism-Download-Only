// PATCH a template: change status (save/archive), or { action: "use" } to spin a
// calendar draft from the chosen platform's caption/hashtags (+ YouTube title).

import { db } from "@/lib/db";
import { createDraft, resolveFormat, splitCaptionHashtags, CHANNELS } from "@/lib/posts";
import { canTouch, getSessionUser } from "@/lib/auth";
import { journal } from "@/lib/memory";
import type { Channel } from "@/lib/postiz";

// Platforms the template agent writes copy for (keys in captions/hashtags JSON).
const COPY_PLATFORMS = ["instagram", "tiktok", "facebook", "youtube", "linkedin", "pinterest", "gbp"] as const;
type CopyPlatform = (typeof COPY_PLATFORMS)[number];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { status?: string; action?: "use"; channel?: string; format?: string }
    | null;
  if (!body) return Response.json({ error: "Missing request body." }, { status: 400 });

  try {
    const template = await db.contentTemplate.findUnique({ where: { id } });
    if (!template || !canTouch(template, user)) return Response.json({ error: "Template not found." }, { status: 404 });

    if (body.action === "use") {
      const channel = body.channel as Channel;
      if (!CHANNELS.includes(channel) || !COPY_PLATFORMS.includes(channel as CopyPlatform)) {
        return Response.json(
          { error: `Pick a channel with generated copy: ${COPY_PLATFORMS.join(", ")}.` },
          { status: 400 }
        );
      }
      const captions = safeParse(template.captions);
      const hashtags = safeParse(template.hashtags);
      // Caption in the caption field, hashtags in the hashtag field (merging any
      // hashtags the agent left inline in the caption with the platform tag set).
      const { caption, hashtags: mergedTags } = splitCaptionHashtags(
        captions[channel as CopyPlatform] || template.title,
        hashtags[channel as CopyPlatform] || ""
      );
      const post = await createDraft({
        channel,
        format: resolveFormat(channel, body.format ?? template.format),
        title:
          channel === "youtube"
            ? template.youtubeTitle ?? template.title
            : channel === "pinterest"
              ? template.title
              : undefined,
        body: caption || template.title,
        hashtags: mergedTags || undefined,
      }, user);
      await db.contentTemplate.update({ where: { id }, data: { status: "used" } });
      // Workspace outcomes only — beta sandboxes stay out of the agents' dreams.
      if (template.userId === "") {
        journal("template-research-agent", {
          kind: "outcome",
          item: "template",
          title: template.title,
          status: "used",
          detail: `drafted for ${channel}`,
        });
      }
      return Response.json({ postId: post.id });
    }

    if (body.status) {
      const updated = await db.contentTemplate.update({ where: { id }, data: { status: body.status } });
      if (template.userId === "") {
        journal("template-research-agent", { kind: "outcome", item: "template", title: template.title, status: body.status });
      }
      return Response.json({ template: { id: updated.id, status: updated.status } });
    }

    return Response.json({ error: "Nothing to do." }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

function safeParse(json: string): Partial<Record<CopyPlatform, string>> {
  try {
    return JSON.parse(json) as Partial<Record<CopyPlatform, string>>;
  } catch {
    return {};
  }
}
