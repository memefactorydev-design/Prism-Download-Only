// Post workflow: draft → pending_approval → approved → scheduled → published.
// The approval gate lives HERE, server-side: schedulePost is only ever called
// from approvePost(), which requires an explicit dashboard decision first.

import type { Post } from "@prisma/client";
import { db } from "@/lib/db";
import { isVideo, readMediaFile } from "@/lib/media";
import { resolveIntegration, schedulePost, uploadMedia, type Channel } from "@/lib/postiz";
import { journal } from "@/lib/memory";
import { track } from "@/lib/events";

export const CHANNELS: Channel[] = [
  "instagram",
  "facebook",
  "tiktok",
  "linkedin",
  "youtube",
  "pinterest",
  "gbp",
];

// Content formats offered per channel. The first entry is each channel's default.
// "post" behaves exactly as before, so existing posts are unaffected.
export const FORMAT_OPTIONS: Record<Channel, string[]> = {
  instagram: ["post", "reel", "carousel", "story"],
  facebook: ["post", "reel", "story"],
  tiktok: ["video"],
  linkedin: ["post", "carousel", "video"],
  youtube: ["short", "video"],
  pinterest: ["post", "video"], // a pin, or a video pin
  gbp: ["post"], // Google Business Profile "What's New" update
};

const VIDEO_FORMATS = new Set(["reel", "video", "short"]);

/**
 * Separate hashtags from caption text so drafts land with the caption in the
 * caption field and hashtags in the hashtag field. Pulls every #tag out of the
 * body (keeping order, de-duped), merges any pre-split hashtags, and tidies the
 * leftover caption whitespace.
 */
export function splitCaptionHashtags(text: string, extraHashtags?: string): { caption: string; hashtags: string } {
  const tags: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const tag = raw.startsWith("#") ? raw : `#${raw}`;
    const key = tag.toLowerCase();
    if (tag.length > 1 && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  };
  const caption = (text ?? "")
    .replace(/#[\p{L}0-9_]+/gu, (m) => {
      add(m);
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (extraHashtags) for (const m of extraHashtags.split(/\s+/).filter(Boolean)) add(m);
  return { caption, hashtags: tags.join(" ") };
}

export type PostStatus =
  | "planned" // a drip stub — the copy generates ~2 days before its slot
  | "generating" // the worker is writing the copy right now
  | "draft"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "published"
  | "failed"
  | "rejected";

interface ChannelSpec {
  maxChars: number;
  requiresMedia: boolean;
  videoOnly: boolean;
  maxItems: number;
  maxImageBytes: number;
  maxVideoBytes: number;
}

// Conservative per-platform limits, enforced before anything reaches Postiz.
export const CHANNEL_SPECS: Record<Channel, ChannelSpec> = {
  instagram: {
    maxChars: 2200,
    requiresMedia: true,
    videoOnly: false,
    maxItems: 10,
    maxImageBytes: 8 * 1024 * 1024,
    maxVideoBytes: 300 * 1024 * 1024,
  },
  facebook: {
    maxChars: 5000,
    requiresMedia: false,
    videoOnly: false,
    maxItems: 10,
    maxImageBytes: 10 * 1024 * 1024,
    maxVideoBytes: 512 * 1024 * 1024,
  },
  tiktok: {
    maxChars: 2200,
    requiresMedia: true,
    videoOnly: true,
    maxItems: 1,
    maxImageBytes: 20 * 1024 * 1024,
    maxVideoBytes: 287 * 1024 * 1024,
  },
  linkedin: {
    maxChars: 3000,
    requiresMedia: false,
    videoOnly: false,
    maxItems: 9,
    maxImageBytes: 8 * 1024 * 1024,
    maxVideoBytes: 200 * 1024 * 1024,
  },
  youtube: {
    maxChars: 5000, // video description
    requiresMedia: true,
    videoOnly: true,
    maxItems: 1,
    maxImageBytes: 2 * 1024 * 1024,
    maxVideoBytes: 1024 * 1024 * 1024,
  },
  pinterest: {
    maxChars: 500, // pin description
    requiresMedia: true, // a pin IS its media
    videoOnly: false,
    maxItems: 1,
    maxImageBytes: 20 * 1024 * 1024,
    maxVideoBytes: 1024 * 1024 * 1024,
  },
  gbp: {
    maxChars: 1500, // GBP post body
    requiresMedia: false,
    videoOnly: false,
    maxItems: 1, // GBP posts carry at most one photo
    maxImageBytes: 5 * 1024 * 1024,
    maxVideoBytes: 75 * 1024 * 1024,
  },
};

export interface PostInput {
  channel: Channel;
  format?: string; // post | reel | carousel | story | short | video
  title?: string; // YouTube title (required there) / Pinterest pin title (optional); ignored by other channels
  body: string;
  hashtags?: string;
  scheduledFor?: string; // ISO
  mediaIds?: string[];  refractionGroup?: string; // shared across one idea's native cuts
}

const POST_INCLUDE = { media: true, approval: true } as const;

// Posts are per-user since the beta: a member's calendar is their own sandbox
// (posts publish through THEIR Postiz), the admin's posts live in the workspace
// scope (""). Admins see everything; members see and touch only their own.
export interface PostActor {
  id: string;
  role: string;
}

/** The Post.userId a given actor's new posts are stamped with. */
export function postScope(actor: PostActor): string {
  return actor.role === "admin" ? "" : actor.id;
}

function assertCanTouch(post: { userId: string }, actor: PostActor): void {
  if (actor.role !== "admin" && post.userId !== actor.id) {
    throw new Error("Post not found."); // don't reveal other users' posts exist
  }
}

export async function listPosts(actor: PostActor) {
  return db.post.findMany({
    where: actor.role === "admin" ? undefined : { userId: actor.id },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

export async function createDraft(input: PostInput, actor: PostActor): Promise<Post> {
  validateBasics(input);
  track("draft_created", postScope(actor), { channel: input.channel, format: input.format ?? "post" });
  return db.post.create({
    data: {
      userId: postScope(actor),
      refractionGroup: input.refractionGroup ?? null,
      channel: input.channel,
      format: resolveFormat(input.channel, input.format),
      title: input.title || null,
      body: input.body,
      hashtags: input.hashtags || null,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
      createdBy: "manual",
      media: { connect: (input.mediaIds ?? []).map((id) => ({ id })) },
    },
    include: POST_INCLUDE,
  });
}

export async function updateDraft(id: string, input: Partial<PostInput>, actor: PostActor): Promise<Post> {
  const post = await mustGet(id, actor);
  if (!["planned", "draft", "pending_approval", "rejected", "failed"].includes(post.status)) {
    throw new Error(`A ${post.status} post can no longer be edited.`);
  }
  if (input.channel || input.body !== undefined) {
    validateBasics({ channel: (input.channel ?? post.channel) as Channel, body: input.body ?? post.body });
  }
  const nextChannel = (input.channel ?? post.channel) as Channel;
  return db.post.update({
    where: { id },
    data: {
      channel: input.channel,
      format: input.format === undefined ? undefined : resolveFormat(nextChannel, input.format),
      title: input.title === undefined ? undefined : input.title || null,
      body: input.body,
      hashtags: input.hashtags === undefined ? undefined : input.hashtags || null,
      scheduledFor: input.scheduledFor === undefined ? undefined : new Date(input.scheduledFor),
      // Editing anything sends it back to draft — re-approval required.
      status: "draft",
      errorMessage: null,
      media: input.mediaIds ? { set: input.mediaIds.map((mid) => ({ id: mid })) } : undefined,
    },
    include: POST_INCLUDE,
  });
}

export async function deletePost(id: string, actor: PostActor): Promise<void> {
  const post = await mustGet(id, actor);
  if (post.status === "scheduled" || post.status === "published") {
    throw new Error(
      `This post is already ${post.status}${post.postizPostId ? ` in Postiz (id ${post.postizPostId})` : ""}. Delete it in Postiz first, then here.`
    );
  }
  await db.approval.deleteMany({ where: { postId: id } });
  await db.post.delete({ where: { id } });
}

/** Full channel validation + create the pending Approval record. */
export async function submitForApproval(id: string, actor: PostActor): Promise<Post> {
  const post = await mustGet(id, actor);
  if (post.status !== "draft" && post.status !== "rejected" && post.status !== "failed") {
    throw new Error(`Only drafts can be submitted (this post is ${post.status}).`);
  }
  const errors = validateForChannel(post.channel as Channel, post);
  if (post.channel === "youtube" && !post.title?.trim()) errors.push("YouTube posts need a title.");
  if (!post.scheduledFor) errors.push("Pick a schedule date and time first.");
  else if (post.scheduledFor.getTime() < Date.now() + 60_000)
    errors.push("The schedule time is in the past — pick a future time.");
  if (errors.length) throw new Error(errors.join(" "));

  await db.approval.upsert({
    where: { postId: id },
    create: {
      kind: "post",
      status: "pending",
      postId: id,
      payload: JSON.stringify({ action: "schedule_post", postId: id, channel: post.channel }),
      reason: `Publish to ${post.channel} at ${post.scheduledFor!.toISOString()}`,
    },
    update: { status: "pending", decidedAt: null },
  });
  return db.post.update({ where: { id }, data: { status: "pending_approval" }, include: POST_INCLUDE });
}

/**
 * The explicit approval gate. Records the decision, then (and only then)
 * pushes to Postiz. A Postiz failure leaves the post "approved" with a visible
 * errorMessage so it can be retried — never a silent failure.
 */
export async function decidePost(id: string, decision: "approve" | "reject", actor: PostActor): Promise<Post> {
  // The gate stays server-side; WHO may decide is scope-based — the admin for
  // workspace posts, each member for their own sandboxed posts (their Postiz,
  // their channels, their risk).
  const post = await mustGet(id, actor);

  // Post approvals are real-world feedback on the copy — journal them for the
  // channel-copy-agent's dream cycle (it owns caption/hashtag quality). Only
  // workspace posts count: beta testers' sandboxes must not colour the brand
  // agents' memory.
  const journalDecision = (status: "approved" | "rejected") => {
    if (post.userId !== "") return;
    journal("channel-copy-agent", {
      kind: "outcome",
      item: `${post.channel} ${post.format} post`,
      title: post.title || post.body.slice(0, 80),
      status,
    });
  };

  if (decision === "reject") {
    if (post.status !== "pending_approval") throw new Error(`This post is ${post.status}, not awaiting approval.`);
    await db.approval.update({
      where: { postId: id },
      data: { status: "rejected", decidedAt: new Date() },
    });
    journalDecision("rejected");
    track("post_rejected", post.userId, { channel: post.channel });
    return db.post.update({ where: { id }, data: { status: "rejected" }, include: POST_INCLUDE });
  }

  // approve — also acts as "retry" for an approved post whose scheduling failed
  if (post.status !== "pending_approval" && post.status !== "approved") {
    throw new Error(`This post is ${post.status}, not awaiting approval.`);
  }
  await db.approval.update({
    where: { postId: id },
    data: { status: "approved", decidedAt: new Date() },
  });
  await db.post.update({ where: { id }, data: { status: "approved", errorMessage: null } });
  journalDecision("approved");
  track("post_approved", post.userId, { channel: post.channel });

  try {
    const scheduled = await pushToPostiz(id);
    track("post_published", post.userId, { channel: post.channel });
    return scheduled;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.post.update({ where: { id }, data: { errorMessage: message } });
    throw new Error(`Approved, but scheduling failed: ${message}`);
  }
}

async function pushToPostiz(id: string): Promise<Post> {
  const post = await db.post.findUniqueOrThrow({ where: { id }, include: { media: true } });
  // The post's OWNER decides which Postiz account it publishes through:
  // "" = the workspace's, anything else = that beta user's own.
  const scope = post.userId;
  const integration = await resolveIntegration(post.channel as Channel, scope);

  const mediaRefs = [];
  for (const asset of post.media) {
    const file = await readMediaFile(asset.id);
    if (!file) throw new Error(`Media file ${asset.originalName} is missing from storage.`);
    mediaRefs.push(await uploadMedia(file.buffer, asset.originalName, asset.mimeType, scope));
  }

  const content = post.hashtags ? `${post.body}\n\n${post.hashtags}` : post.body;
  const { postizPostId } = await schedulePost({
    integrationId: integration.id,
    channel: post.channel as Channel,
    format: post.format,
    title: post.title ?? undefined,
    content,
    media: mediaRefs,
    scheduledFor: post.scheduledFor!,
  }, scope);

  return db.post.update({
    where: { id },
    data: { status: "scheduled", postizPostId, errorMessage: null },
    include: POST_INCLUDE,
  });
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateBasics(input: { channel: Channel; body: string }) {
  if (!CHANNELS.includes(input.channel)) throw new Error(`Unknown channel "${input.channel}".`);
  if (!input.body?.trim()) throw new Error("The post needs some text.");
  const spec = CHANNEL_SPECS[input.channel];
  if (input.body.length > spec.maxChars) {
    throw new Error(`${input.channel} captions max out at ${spec.maxChars} characters (this one is ${input.body.length}).`);
  }
}

/**
 * Clamp AI-written copy to the channel's caption limit, cutting at the last
 * sentence (or word) boundary that fits — agents are told the limit, but a
 * long caption must degrade gracefully rather than fail draft validation.
 */
export function clampCaption(channel: Channel, text: string): string {
  const max = CHANNEL_SPECS[channel].maxChars;
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max);
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (sentenceEnd > max * 0.5) return slice.slice(0, sentenceEnd + 1).trim();
  const wordEnd = slice.lastIndexOf(" ");
  return (wordEnd > 0 ? slice.slice(0, wordEnd) : slice).trim();
}

/** Snap a requested format to one valid for the channel (defaults to the channel's first option). */
export function resolveFormat(channel: Channel, format?: string): string {
  const options = FORMAT_OPTIONS[channel] ?? ["post"];
  const wanted = format?.trim().toLowerCase();
  return wanted && options.includes(wanted) ? wanted : options[0];
}

function validateForChannel(
  channel: Channel,
  post: { format: string; body: string; hashtags: string | null; media: { mimeType: string; sizeBytes: number; originalName: string }[] }
): string[] {
  const spec = CHANNEL_SPECS[channel];
  const errors: string[] = [];
  const format = post.format || "post";
  const combined = post.hashtags ? `${post.body}\n\n${post.hashtags}` : post.body;
  if (combined.length > spec.maxChars) {
    errors.push(`Caption + hashtags is ${combined.length} chars — over ${channel}'s ${spec.maxChars} limit.`);
  }
  if (spec.requiresMedia && post.media.length === 0) {
    errors.push(`${channel} posts need at least one ${spec.videoOnly ? "video" : "image or video"}.`);
  }
  if (post.media.length > spec.maxItems) {
    errors.push(`${channel} allows at most ${spec.maxItems} media item(s); this post has ${post.media.length}.`);
  }
  // Format-specific media rules (only tighten — "post" keeps prior behaviour).
  const images = post.media.filter((m) => !isVideo(m.mimeType));
  const videos = post.media.filter((m) => isVideo(m.mimeType));
  if (format === "carousel" && post.media.length < 2) {
    errors.push(`A carousel needs at least 2 media items (this ${channel} post has ${post.media.length}).`);
  }
  if (VIDEO_FORMATS.has(format)) {
    if (videos.length !== 1 || images.length > 0) {
      errors.push(`A ${format} needs exactly one video (this ${channel} post has ${videos.length} video(s) and ${images.length} image(s)).`);
    }
  }
  if (format === "story" && post.media.length !== 1) {
    errors.push(`A story needs exactly one media item (this ${channel} post has ${post.media.length}).`);
  }
  for (const m of post.media) {
    const video = isVideo(m.mimeType);
    if (spec.videoOnly && !video) {
      errors.push(`${channel} needs video — "${m.originalName}" is an image.`);
    }
    const cap = video ? spec.maxVideoBytes : spec.maxImageBytes;
    if (m.sizeBytes > cap) {
      errors.push(
        `"${m.originalName}" is ${(m.sizeBytes / 1024 / 1024).toFixed(1)} MB — over ${channel}'s ${Math.round(cap / 1024 / 1024)} MB ${video ? "video" : "image"} limit.`
      );
    }
  }
  return errors;
}

async function mustGet(id: string, actor: PostActor) {
  const post = await db.post.findUnique({ where: { id }, include: POST_INCLUDE });
  if (!post) throw new Error("Post not found.");
  assertCanTouch(post, actor);
  return post;
}
