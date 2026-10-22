// fal.ai client — the PRIMARY video engines for the whole app, routed by plan
// (owner's bake-off verdict 2026-07-12): Kling 3.0 standard for the lower two
// tiers (~1/3 the cost, near-parity quality), Seedance 2.0 Fast for the upper
// tiers and unset/owner deployments (best shot-to-shot consistency — the USP).
// Veo via Gemini stays the automatic BACKUP only (reliability when fal is
// down; too expensive as a primary). Queue API: submit → poll status → fetch
// result. Model ids are env-overridable; failures (incl. "Exhausted balance")
// surface loudly with fal's own message.

import { getSecrets } from "@/lib/connections";

const QUEUE_BASE = "https://queue.fal.run";
// Seedance 2.0 Fast: near-Pro quality at ~20% lower per-second cost. Override
// with FAL_VIDEO_MODEL to move tiers/models. The text-to-video variant is
// derived by swapping the trailing path segment (both engines).
const VIDEO_MODEL = process.env.FAL_VIDEO_MODEL || "bytedance/seedance-2.0/fast/image-to-video";
const KLING_MODEL = process.env.FAL_KLING_MODEL || "fal-ai/kling-video/v3/standard/image-to-video";

export type FalEngine = "kling" | "seedance";

/** Which fal engine this deployment's plan runs on. Lower tiers ride Kling;
 *  agency/enterprise (and unset = owner/pre-billing) get Seedance. */
export function planVideoEngine(): FalEngine {
  const plan = (process.env.PRISM_PLAN || "").trim().toLowerCase();
  return plan === "starter" || plan === "growth" ? "kling" : "seedance";
}

/** The hard per-render duration cap Seedance accepts (fal `duration` enum 4-15s).
 *  Recorded on every render — anything longer is cut into segments and stitched. */
export const SEEDANCE_MAX_SECS = 15;
export const SEEDANCE_MIN_SECS = 4;

export async function falConnected(): Promise<boolean> {
  return Boolean(await getSecrets("fal"));
}

async function falKey(): Promise<string> {
  const secrets = await getSecrets("fal");
  if (!secrets?.apiKey) throw new Error("fal.ai isn't connected yet — add your key on the Connections page.");
  return secrets.apiKey;
}

async function falFetch(url: string, key: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

interface QueueSubmit {
  request_id?: string;
  status_url?: string;
  response_url?: string;
}

async function submitAndWait(model: string, input: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
  const key = await falKey();
  const sub = (await falFetch(`${QUEUE_BASE}/${model}`, key, {
    method: "POST",
    body: JSON.stringify(input),
  })) as QueueSubmit;
  if (!sub.status_url || !sub.response_url) throw new Error("fal.ai returned no queue URLs.");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("fal.ai generation timed out — check fal.ai/dashboard for the run.");
    await new Promise((r) => setTimeout(r, 3000));
    const status = await falFetch(sub.status_url, key);
    if (status.status === "COMPLETED") break;
    if (status.status === "FAILED" || status.status === "ERROR") {
      throw new Error(`fal.ai generation failed: ${JSON.stringify(status).slice(0, 200)}`);
    }
  }
  return falFetch(sub.response_url, key);
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`fal.ai file download failed (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * fal video generation on the plan's engine (or an explicit one). With
 * `firstFrame` the clip animates FROM that image (image-to-video); without it,
 * pure text-to-video. `seconds` is clamped to the shared per-render window —
 * callers wanting longer output stitch multiple renders (the ad-film pipeline).
 * Morph bridges (`endFrame`) always run on Seedance — its `end_image_url`
 * contract is live-proven; Kling's end-frame support is unverified here.
 */
export async function falVideo(
  prompt: string,
  firstFrame?: { mime: string; buffer: Buffer },
  seconds = 5,
  aspect: "9:16" | "16:9" = "9:16",
  audio = true, // ad-film segments pass false: the VO is the soundtrack, and
  //               generated audio can trip fal's content filter
  endFrame?: { mime: string; buffer: Buffer }, // with firstFrame: a morph — the
  //               clip transforms from the first frame INTO this one
  engineOverride?: FalEngine
): Promise<Buffer> {
  const engine: FalEngine = endFrame ? "seedance" : engineOverride ?? planVideoEngine();
  const duration = Math.max(SEEDANCE_MIN_SECS, Math.min(SEEDANCE_MAX_SECS, Math.round(seconds)));
  const base = engine === "kling" ? KLING_MODEL : VIDEO_MODEL;
  const model = firstFrame ? base : base.replace(/image-to-video$/, "text-to-video");
  // Kling's schema is leaner: no resolution field, and i2v follows the source
  // image's aspect. Unknown fields 422 on fal, so build inputs per engine.
  const input: Record<string, unknown> = {
    prompt,
    duration: String(duration),
    generate_audio: audio,
  };
  if (engine === "seedance") {
    input.aspect_ratio = aspect;
    input.resolution = "720p";
  } else if (!firstFrame) {
    input.aspect_ratio = aspect;
  }
  if (firstFrame) {
    input.image_url = `data:${firstFrame.mime};base64,${firstFrame.buffer.toString("base64")}`;
    if (endFrame) {
      input.end_image_url = `data:${endFrame.mime};base64,${endFrame.buffer.toString("base64")}`;
    }
  }
  const result = await submitAndWait(model, input, 600_000);
  const video = result.video as { url?: string } | undefined;
  if (!video?.url) throw new Error(`fal.ai returned no video: ${JSON.stringify(result).slice(0, 200)}`);
  return download(video.url);
}
