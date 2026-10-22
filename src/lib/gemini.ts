// Gemini API wrappers: text (with optional Google Search grounding), Nano Banana
// image generation, and Veo video generation. The key comes from the `gemini`
// connection (Connections page, GEMINI_API_KEY env fallback).
//
// Server-only. Used by the named-agent engine (live research) and the Ad Studio.

import { getSecrets } from "@/lib/connections";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function geminiKey(): Promise<string> {
  const secrets = await getSecrets("gemini");
  if (!secrets?.apiKey) {
    throw new Error("Google Gemini isn't connected yet — see the Connections page.");
  }
  return secrets.apiKey;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = new Set([429, 500, 503, 529]);

async function call(
  key: string,
  pathname: string,
  body: unknown,
  method: "POST" | "GET" = "POST",
  retries = 2
): Promise<Record<string, unknown>> {
  let lastErr: Error & { status?: number } = new Error("Gemini call failed");
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${API_BASE}${pathname}`, {
      method,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(240_000),
    });
    if (res.ok) return (await res.json()) as Record<string, unknown>;
    const detail = await res.text().catch(() => "");
    lastErr = Object.assign(new Error(`Gemini API ${res.status}: ${detail.slice(0, 400)}`), {
      status: res.status,
    });
    if (!TRANSIENT.has(res.status) || attempt === retries) break;
    await sleep(1500 * (attempt + 1));
  }
  throw lastErr;
}

export interface GeminiSource {
  uri: string;
  title: string;
}
export interface GeminiTextResult {
  text: string;
  sources: GeminiSource[];
  model: string;
}

// Model ladder: best first; overloaded/out-of-quota models fall through to lighter ones.
const TEXT_FALLBACKS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

export async function geminiText(opts: {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  useSearch?: boolean;
  json?: boolean;
}): Promise<GeminiTextResult> {
  const key = await geminiKey();
  const primary = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-pro";
  const models = [primary, ...TEXT_FALLBACKS.filter((m) => m !== primary)];

  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: opts.system }] },
    contents: opts.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
  if (opts.useSearch) body.tools = [{ google_search: {} }];
  if (opts.json && !opts.useSearch) body.generationConfig = { response_mime_type: "application/json" };

  let lastErr: unknown;
  for (const model of models) {
    try {
      const data = await call(key, `/models/${model}:generateContent`, body, "POST", 1);
      const cand = (data.candidates as Array<Record<string, unknown>> | undefined)?.[0];
      const content = cand?.content as { parts?: Array<{ text?: string }> } | undefined;
      const text = (content?.parts ?? []).map((p) => p.text ?? "").join("");
      const grounding = cand?.groundingMetadata as
        | { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> }
        | undefined;
      const sources: GeminiSource[] = (grounding?.groundingChunks ?? [])
        .map((c) => (c.web?.uri ? { uri: c.web.uri, title: c.web.title ?? c.web.uri } : null))
        .filter((s): s is GeminiSource => s !== null);
      return { text, sources, model };
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (!status || !TRANSIENT.has(status)) throw err;
    }
  }
  throw lastErr;
}

/** Parse a JSON object out of a model response, tolerating markdown fences. */
export function parseModelJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.search(/[{[]/);
  return JSON.parse(start > 0 ? cleaned.slice(start) : cleaned) as T;
}

export interface SourceImage {
  mime: string;
  buffer: Buffer;
}

/**
 * Nano Banana image generation. Returns raw bytes + mime.
 * With `sourceImages`, this becomes an EDIT: the model composes/grades/extends
 * the supplied photos per the prompt — real footage in, polished ad visual out.
 */
export async function geminiImage(prompt: string, sourceImages: SourceImage[] = []): Promise<{ mime: string; buffer: Buffer }> {
  const key = await geminiKey();
  // Nano Banana Pro — the latest Gemini image model; ALL app images use this
  // (owner's instruction 2026-07-12). Override with GEMINI_IMAGE_MODEL.
  const model = process.env.GEMINI_IMAGE_MODEL ?? "nano-banana-pro-preview";
  const imageParts = sourceImages.slice(0, 3).map((img) => ({
    inlineData: { mimeType: img.mime, data: img.buffer.toString("base64") },
  }));
  const data = await call(key, `/models/${model}:generateContent`, {
    contents: [{ parts: [...imageParts, { text: prompt }] }],
  });
  const parts =
    ((data.candidates as Array<Record<string, unknown>> | undefined)?.[0]?.content as
      | { parts?: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> }
      | undefined)?.parts ?? [];
  const inline = parts.find((p) => p.inlineData)?.inlineData;
  if (!inline) {
    const refusal = parts.map((p) => p.text ?? "").join(" ").trim();
    throw new Error(`No image returned${refusal ? `: ${refusal.slice(0, 200)}` : ""}`);
  }
  return { mime: inline.mimeType, buffer: Buffer.from(inline.data, "base64") };
}

/**
 * Start a Veo video generation job; returns the operation name to poll.
 * With `firstFrame`, Veo animates FROM the supplied image (image-to-video) —
 * the ad opens on the owner's real photo rather than an invented scene. The
 * exact parameter support is verified on the first live call and any API
 * rejection surfaces loudly (never a silent fallback to text-only).
 */
export async function startVeoVideo(
  prompt: string,
  firstFrame?: SourceImage,
  aspectRatio?: "16:9" | "9:16"
): Promise<string> {
  const key = await geminiKey();
  // Google retired veo-3.0-generate-001 (404s on predictLongRunning); 3.1 is
  // what current keys serve. Override with GEMINI_VIDEO_MODEL if it moves again.
  const model = process.env.GEMINI_VIDEO_MODEL ?? "veo-3.1-generate-preview";
  const instance: Record<string, unknown> = { prompt };
  if (firstFrame) {
    instance.image = { bytesBase64Encoded: firstFrame.buffer.toString("base64"), mimeType: firstFrame.mime };
  }
  const data = await call(key, `/models/${model}:predictLongRunning`, {
    instances: [instance],
    ...(aspectRatio ? { parameters: { aspectRatio } } : {}),
  });
  if (!data.name) throw new Error("Veo did not return an operation name.");
  return data.name as string;
}

export async function veoStatus(
  operationName: string
): Promise<{ done: boolean; error?: string; buffer?: Buffer }> {
  const key = await geminiKey();
  const data = await call(key, `/${operationName}`, null, "GET");
  if (!data.done) return { done: false };
  if (data.error) {
    return { done: true, error: (data.error as { message?: string }).message ?? "Video generation failed" };
  }
  const resp = (data.response ?? {}) as Record<string, unknown>;
  const videoUri =
    (resp.generateVideoResponse as { generatedSamples?: Array<{ video?: { uri?: string } }> } | undefined)
      ?.generatedSamples?.[0]?.video?.uri ??
    (resp.generatedVideos as Array<{ video?: { uri?: string } }> | undefined)?.[0]?.video?.uri ??
    (resp.videos as Array<{ uri?: string }> | undefined)?.[0]?.uri ??
    null;
  if (!videoUri) return { done: true, error: "No video URI in the Veo response" };
  const res = await fetch(videoUri, { headers: { "x-goog-api-key": key } });
  if (!res.ok) return { done: true, error: `Video download failed: HTTP ${res.status}` };
  return { done: true, buffer: Buffer.from(await res.arrayBuffer()) };
}
