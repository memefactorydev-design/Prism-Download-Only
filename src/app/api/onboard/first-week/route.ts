// First Light screen 4 — the refraction, live. NDJSON stream: narrative
// stages while the supervisor plans the week, the three soonest stubs get
// REAL copy, then each draft gets a brand-true AI image — and when a video
// engine is connected, the strongest video-format draft gets a real vertical
// clip animated FROM its image (brand-consistent by construction). Media
// failures degrade honestly: onboarding never dies because a picture didn't.

import { db } from "@/lib/db";
import { planWeek, writePlannedCopy } from "@/lib/drip";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { getBrandProfile } from "@/lib/brand-profile";
import { saveGeneratedAsset } from "@/lib/adstudio";
import { geminiImage } from "@/lib/gemini";
import { falConnected, falVideo } from "@/lib/fal";
import { assertVideoQuota } from "@/lib/quota";
import { meterUsage, track } from "@/lib/events";

export const maxDuration = 300;

const VIDEO_FORMATS = new Set(["reel", "short", "video", "story"]);

export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        send({ type: "stage", label: "Scanning what's working in your market…" });
        const created = await planWeek(scope);
        send({ type: "stage", label: `Week sketched — ${created} posts planned. Writing the first three now…` });

        // Three soonest stubs on DISTINCT channels → real copy, right now.
        const stubs = await db.post.findMany({
          where: { userId: scope, status: "planned" },
          orderBy: { scheduledFor: "asc" },
          take: 10,
        });
        const picked: typeof stubs = [];
        for (const s of stubs) {
          if (picked.length >= 3) break;
          if (!picked.some((p) => p.channel === s.channel)) picked.push(s);
        }
        const drafts = [];
        for (const stub of picked) {
          send({ type: "stage", label: `Drafting your ${stub.channel} post — "${(stub.title ?? "").slice(0, 60)}"` });
          const done = await writePlannedCopy(stub.id, { withImage: false });
          if (done) {
            drafts.push({
              id: done.id,
              channel: done.channel,
              format: done.format,
              title: done.title,
              body: done.body,
              hashtags: done.hashtags,
              scheduledFor: done.scheduledFor?.toISOString() ?? null,
            });
            send({ type: "draft", draft: drafts[drafts.length - 1] });
          }
        }

        // ── Media: an image for every draft, then one real video clip. ──────
        const brand = await getBrandProfile(scope);
        const brandLine = brand
          ? `${brand.businessName} — ${brand.whatYouSell}. ${brand.voice ? `Tone: ${brand.voice}.` : ""}`
          : "";
        const imageAssetByPost = new Map<string, { id: string; buffer: Buffer; mime: string }>();
        for (const d of drafts) {
          send({ type: "media_start", postId: d.id, kind: "image" });
          send({ type: "stage", label: `Shooting the ${d.channel} visual…` });
          try {
            const prompt = [
              `Premium social-media imagery for this ${d.channel} post. Brand: ${brandLine}`,
              `Post: ${(d.title ? d.title + ". " : "") + d.body.slice(0, 500)}`,
              "Photoreal, editorial, scroll-stopping, vertical-friendly composition. No text, no words, no watermarks.",
            ].join("\n");
            // One retry: image models occasionally return empty on a first pass.
            const img = await geminiImage(prompt).catch(() => geminiImage(prompt));
            const asset = await saveGeneratedAsset(img.buffer, img.mime, `First week — ${d.channel} visual`, scope);
            await db.post.update({ where: { id: d.id }, data: { media: { connect: { id: asset.id } } } });
            meterUsage(scope, "image_gen", 1, { kind: "onboarding" });
            imageAssetByPost.set(d.id, { id: asset.id, buffer: img.buffer, mime: img.mime });
            send({ type: "media", postId: d.id, kind: "image", url: `/api/media/${asset.id}/file` });
          } catch (err) {
            console.error("[first-week] image failed:", err instanceof Error ? err.message : err);
            send({ type: "media_skip", postId: d.id, kind: "image" });
          }
        }

        // One hero clip: the first video-format draft, animated FROM its image.
        const videoDraft = drafts.find((d) => VIDEO_FORMATS.has(d.format) && imageAssetByPost.has(d.id));
        if (videoDraft && (await falConnected())) {
          try {
            await assertVideoQuota(1); // quota-exhausted degrades to images-only
            send({ type: "media_start", postId: videoDraft.id, kind: "video" });
            send({ type: "stage", label: "Now the showpiece — bringing your first reel to life (about two minutes)…" });
            const src = imageAssetByPost.get(videoDraft.id)!;
            const prompt = [
              `Cinematic vertical social clip for ${brandLine || "this brand"}.`,
              `The post: ${(videoDraft.title ? videoDraft.title + ". " : "") + videoDraft.body.slice(0, 300)}`,
              "Bring the scene alive with premium, subtle motion. No text.",
            ].join("\n");
            // Sound on: engine ambience makes the clip feel finished. fal's
            // content filter occasionally rejects generated audio — retry silent.
            const buffer = await falVideo(prompt, { mime: src.mime, buffer: src.buffer }, 7, "9:16", true).catch(() =>
              falVideo(prompt, { mime: src.mime, buffer: src.buffer }, 7, "9:16", false)
            );
            const asset = await saveGeneratedAsset(buffer, "video/mp4", `First week — ${videoDraft.channel} reel`, scope);
            await db.post.update({ where: { id: videoDraft.id }, data: { media: { connect: { id: asset.id } } } });
            meterUsage(scope, "video_gen", 1, { kind: "onboarding" });
            send({ type: "media", postId: videoDraft.id, kind: "video", url: `/api/media/${asset.id}/file` });
          } catch (err) {
            console.error("[first-week] video failed:", err instanceof Error ? err.message : err);
            send({ type: "media_skip", postId: videoDraft.id, kind: "video" });
          }
        }

        track("onboarding_completed", scope, { planned: created, drafted: drafts.length, media: imageAssetByPost.size });
        send({ type: "done", planned: created, drafts });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}
