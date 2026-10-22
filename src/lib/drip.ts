// P1.6 — rolling drip generation. A planned week is STUBS, not content: each
// planned post carries a channel, an angle and a scheduled slot. The worker
// writes the actual copy ~2 days before the slot (spreads compute, keeps the
// calendar alive, no day-one credit shock) and flips the post to a normal
// draft — media channels still need their media attached, and everything
// still passes the approval gate before publishing.

import { db } from "@/lib/db";
import { geminiImage } from "@/lib/gemini";
import { saveGeneratedAsset } from "@/lib/adstudio";
import { getBrandProfile } from "@/lib/brand-profile";
import { runAgent } from "@/lib/agents/run-agent";
import { splitCaptionHashtags, resolveFormat } from "@/lib/posts";
import type { Channel } from "@/lib/postiz";
import { relevantTrendInsights } from "@/lib/trends";
import { meterUsage, track } from "@/lib/events";

export const DRIP_LEAD_DAYS = 2;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      description: "5-7 post stubs spread across the next 7 days, varied channels and angles.",
      items: {
        type: "object",
        properties: {
          channel: { type: "string", description: "instagram | facebook | tiktok | linkedin | youtube | pinterest | gbp" },
          format: { type: "string", description: "post | reel | carousel | story | short | video — must suit the channel" },
          title: { type: "string", description: "Working title for the calendar." },
          angle: { type: "string", description: "2-3 sentences: the idea, the hook, what the post should achieve." },
          dayOffset: { type: "number", description: "0-6 — days from tomorrow." },
          hour: { type: "number", description: "Posting hour 7-20, platform-sensible." },
        },
        required: ["channel", "format", "title", "angle", "dayOffset", "hour"],
        additionalProperties: false,
      },
    },
  },
  required: ["posts"],
  additionalProperties: false,
};

const PLAN_CHANNELS = ["instagram", "facebook", "tiktok", "linkedin", "youtube", "pinterest", "gbp"];

/** Create planned post stubs (status "planned"); copy drips later. */
export async function planWeek(scopeUserId: string, opts: { count?: number; horizonDays?: number } = {}): Promise<number> {
  const count = Math.min(Math.max(opts.count ?? 7, 1), 7);
  const horizon = Math.min(Math.max(opts.horizonDays ?? 6, 1), 6);
  const trends = await db.trendInsight.findMany({
    where: { userId: scopeUserId },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  const task = [
    `Plan ${count} social post stub${count === 1 ? "" : "s"} across the next ${horizon + 1} days — channel, format, working title, a 2-3 sentence angle, day and hour.`,
    "Varied channels, no two identical angles. Full copy is written later, so angles must be self-explanatory.",
    "Lean on the trend briefs below where they genuinely fit; otherwise plan proven evergreen angles.",
    "",
    trends.length
      ? `## Current trend briefs\n${trends.map((t) => `- [${t.platform}] ${t.title}: ${t.hook}`).join("\n")}`
      : "## Current trend briefs\n(none yet — plan evergreen angles)",
  ].join("\n");

  const { data } = await runAgent<{ posts: { channel: string; format: string; title: string; angle: string; dayOffset: number; hour: number }[] }>(
    "marketing-supervisor",
    task,
    { schema: PLAN_SCHEMA, maxTokens: 8000, reportKind: "week_plan", reportTitle: "Planned week", scopeUserId }
  );
  if (!data?.posts?.length) throw new Error("The planner returned no posts — try again.");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  let created = 0;
  for (const p of data.posts.slice(0, count)) {
    if (!PLAN_CHANNELS.includes(p.channel)) continue;
    const when = new Date(tomorrow);
    when.setDate(when.getDate() + Math.min(Math.max(Math.round(p.dayOffset), 0), horizon));
    when.setHours(Math.min(Math.max(Math.round(p.hour), 6), 21), 0, 0, 0);
    await db.post.create({
      data: {
        userId: scopeUserId,
        channel: p.channel,
        format: resolveFormat(p.channel as Channel, p.format),
        title: p.title.slice(0, 200),
        body: p.angle.slice(0, 1200), // the working angle — replaced when the copy drips in
        status: "planned",
        scheduledFor: when,
        createdBy: "agent",
      },
    });
    created += 1;
  }
  if (!created) throw new Error("The planner's stubs didn't fit any supported channel — try again.");
  track("draft_created", scopeUserId, { via: "plan_week", count: created });
  return created;
}

/**
 * Worker tick: write the copy for planned posts whose slot is within the lead
 * window. One at a time per tick — drip, not flood.
 */
export async function dripTick(): Promise<void> {
  const windowEnd = new Date(Date.now() + DRIP_LEAD_DAYS * 24 * 60 * 60 * 1000);
  const due = await db.post.findFirst({
    where: { status: "planned", scheduledFor: { lte: windowEnd } },
    orderBy: { scheduledFor: "asc" },
  });
  if (!due) return;
  await writePlannedCopy(due.id);
}

/** Write the real copy for one planned stub; returns the updated post or null. */
export async function writePlannedCopy(postId: string, opts: { withImage?: boolean } = {}) {
  const due = await db.post.findUnique({ where: { id: postId } });
  if (!due || !["planned"].includes(due.status)) return null;

  // Claim it so a crashed run can't double-generate.
  await db.post.update({ where: { id: due.id }, data: { status: "generating" } });
  try {
    const trends = await relevantTrendInsights(`${due.title ?? ""} ${due.body}`, 3, due.userId);
    const task = [
      `Write the final ${due.channel} ${due.format} copy for this planned post. Caption plus hashtags, platform-native.`,
      "",
      `## Working title\n${due.title ?? "(none)"}`,
      `## The angle\n${due.body}`,
      trends.length ? `\n## Trend context\n${trends.map((t) => `- ${t.title}: ${t.hook}`).join("\n")}` : "",
    ].join("\n");
    const { data } = await runAgent<{ caption: string; hashtags: string }>("channel-copy-agent", task, {
      schema: {
        type: "object",
        properties: { caption: { type: "string" }, hashtags: { type: "string" } },
        required: ["caption", "hashtags"],
        additionalProperties: false,
      },
      maxTokens: 4000,
      reportKind: "channel_copy",
      reportTitle: `Drip copy: ${due.title ?? due.channel}`,
      scopeUserId: due.userId,
    });
    if (!data?.caption) throw new Error("no copy returned");
    const split = splitCaptionHashtags(data.caption, data.hashtags);

    // Every drafted post arrives with its visual: a brand-true AI image is
    // generated at copy time (best-effort — a failed image never loses the
    // copy; onboarding's first-week flow passes withImage:false because it
    // streams its own image reveal). Skipped when media is already attached.
    let hasMedia = (await db.post.findUnique({ where: { id: due.id }, include: { media: true } }))!.media.length > 0;
    if (opts.withImage !== false && !hasMedia) {
      try {
        const brand = await getBrandProfile(due.userId);
        const brandLine = brand
          ? `${brand.businessName} — ${brand.whatYouSell}. ${brand.voice ? `Tone: ${brand.voice}.` : ""}`
          : "";
        const prompt = [
          `Premium social-media imagery for this ${due.channel} post. Brand: ${brandLine}`,
          `Post: ${(due.title ? due.title + ". " : "") + split.caption.slice(0, 500)}`,
          "Photoreal, editorial, scroll-stopping, vertical-friendly composition. No text, no words, no watermarks.",
        ].join("\n");
        const img = await geminiImage(prompt).catch(() => geminiImage(prompt));
        const asset = await saveGeneratedAsset(img.buffer, img.mime, `${due.channel} visual — ${(due.title ?? "post").slice(0, 50)}`, due.userId);
        await db.post.update({ where: { id: due.id }, data: { media: { connect: { id: asset.id } } } });
        meterUsage(due.userId, "image_gen", 1, { kind: "drip" });
        hasMedia = true;
      } catch (err) {
        console.error("[drip] image generation failed (copy kept):", err instanceof Error ? err.message : err);
      }
    }

    // With a visual attached, media-led channels can go straight to Review
    // too — the approval gate stays the decision point for everything.
    const needsMedia = ["instagram", "tiktok", "youtube", "pinterest"].includes(due.channel);
    const futureSlot = due.scheduledFor && due.scheduledFor.getTime() > Date.now() + 60_000;
    const toReview = (hasMedia || !needsMedia) && futureSlot;
    await db.post.update({
      where: { id: due.id },
      data: { status: toReview ? "pending_approval" : "draft", body: split.caption, hashtags: split.hashtags || null },
    });
    if (toReview) {
      await db.approval.upsert({
        where: { postId: due.id },
        create: {
          kind: "post",
          status: "pending",
          payload: JSON.stringify({ postId: due.id, channel: due.channel }),
          reason: "Drip-written from your planned week — ready for your yes.",
          postId: due.id,
        },
        update: { status: "pending", decidedAt: null },
      });
    }
    track("draft_created", due.userId, { via: "drip", channel: due.channel });
    console.log(`[drip] wrote copy for ${due.id} (${due.channel}, scheduled ${due.scheduledFor?.toISOString()})`);
    return db.post.findUnique({ where: { id: due.id } });
  } catch (err) {
    // Back to planned so the next tick retries; never lose the slot.
    await db.post.update({ where: { id: due.id }, data: { status: "planned" } }).catch(() => {});
    console.error(`[drip] ${due.id} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * P3.1 — drafts at breakfast. Once a day, any active scope (the workspace +
 * every member with a brand profile) that has fewer than 3 upcoming posts gets
 * a small planned top-up; the drip writes the copy overnight, so mornings
 * start with content waiting in Review.
 */
export async function overnightTick(): Promise<void> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const already = await db.event.findFirst({ where: { name: "overnight_run", createdAt: { gte: midnight } } });
  if (already) return;
  const hour = new Date().getHours();
  if (hour < 4 || hour > 6) return; // the quiet window after the dream cycle
  track("overnight_run", "", {});

  const profiles = await db.brandProfile.findMany({ select: { userId: true } });
  // The workspace ("") now has a profile row of its own — dedupe so it runs once.
  const scopes = [...new Set(["", ...profiles.map((p) => p.userId)])];
  for (const scope of scopes) {
    try {
      const upcoming = await db.post.count({
        where: {
          userId: scope,
          status: { in: ["planned", "generating", "draft", "pending_approval"] },
          OR: [{ scheduledFor: null }, { scheduledFor: { gte: new Date() } }],
        },
      });
      if (upcoming >= 3) continue;
      const made = await planWeek(scope, { count: 3, horizonDays: 3 });
      console.log(`[overnight] topped up ${scope || "workspace"} with ${made} stubs`);
    } catch (err) {
      console.error(`[overnight] ${scope || "workspace"}:`, err instanceof Error ? err.message : err);
    }
  }
}
