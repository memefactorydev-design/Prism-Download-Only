// Hand a rendered clip to the existing posting pipeline: create a draft Post that
// references the clip's rendered MediaAsset. The owner finishes scheduling and goes
// through the normal approval gate on the Calendar — Studio never posts directly.

import { db } from "@/lib/db";
import { createDraft, resolveFormat, splitCaptionHashtags, CHANNELS } from "@/lib/posts";
import { refractDraft } from "@/lib/refract";
import { getBrandProfile } from "@/lib/brand-profile";
import { scopeOf } from "@/lib/auth";
import { canTouch, getSessionUser } from "@/lib/auth";
import type { Channel } from "@/lib/postiz";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { channel?: string; refract?: boolean };
  const channel = body.channel;
  if (!body.refract && (!channel || !CHANNELS.includes(channel as Channel))) {
    return Response.json({ error: `Pick a valid channel (${CHANNELS.join(", ")}).` }, { status: 400 });
  }

  const clip = await db.generatedClip.findUnique({ where: { id }, include: { job: true } });
  if (!clip || !canTouch(clip.job, user)) return Response.json({ error: "Clip not found." }, { status: 404 });
  if (clip.status !== "rendered" || !clip.assetId) {
    return Response.json({ error: "This clip hasn't finished rendering yet." }, { status: 409 });
  }

  // Split the clip's suggested caption so hashtags land in the hashtag field.
  const raw = clip.caption?.trim() || clip.hook?.trim() || clip.title;
  const { caption, hashtags } = splitCaptionHashtags(raw);

  try {
    // Refraction is the default path: one clip → native cuts for the user's
    // channels, shown side by side in Review. Single-channel is the opt-out.
    if (body.refract) {
      const scope = scopeOf(user);
      const profile = await getBrandProfile(scope);
      const channels = (profile?.channels?.split(",").map((c) => c.trim()).filter(Boolean) ?? []).slice(0, 7);
      const targets = channels.length >= 2 ? channels : ["instagram", "facebook", "tiktok"];
      const posts = await refractDraft(
        { title: clip.title, body: caption || clip.title, hashtags, mediaIds: [clip.assetId], isVideo: true },
        targets,
        user,
        scope
      );
      return Response.json({ ok: true, postIds: posts.map((x) => x.id), channels: posts.map((x) => x.channel) });
    }
    const ch = channel as Channel;
    const draft = await createDraft({
      channel: ch,
      // A rendered reel is a vertical video → reel/short/video pin per channel.
      format: resolveFormat(ch, ch === "youtube" ? "short" : ch === "pinterest" ? "video" : "reel"),
      title: ch === "youtube" || ch === "pinterest" ? clip.title : undefined,
      body: caption || clip.title,
      hashtags: hashtags || undefined,
      mediaIds: [clip.assetId],
    }, user);
    return Response.json({ ok: true, postId: draft.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
