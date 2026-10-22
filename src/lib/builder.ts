// Website/landing-page builder: turns a chat instruction into a complete,
// self-contained HTML document via web-designer-agent on the active AI engine.
// Streams where the engine can; returns cleaned HTML ready to preview in an
// iframe and publish. Heavy design work — runs from an API route, never the
// client bundle.

import { generateText } from "@/lib/llm";
import { loadAgentDefinition } from "@/lib/agents/run-agent";
import { brandTaskSuffix } from "@/lib/brand-profile";
import { journal } from "@/lib/memory";

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `site-${Date.now().toString(36)}`
  );
}

// Strip accidental markdown fences / preamble and keep the HTML document.
function cleanHtml(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!doctype html>|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  return t.trim();
}

export async function generatePage(opts: {
  instruction: string;
  currentHtml: string;
  siteName: string;
  pageTitle: string;
  kind: string;
  scopeUserId?: string; // member sites are designed for THEIR brand
  /** Live progress: called with the accumulated raw text as the designer writes. */
  onDelta?: (accumulated: string) => void;
}): Promise<string> {
  const def = await loadAgentDefinition("web-designer-agent");

  const context = opts.currentHtml.trim()
    ? `This is the CURRENT page HTML. Apply the request and keep everything else intact; return the COMPLETE updated document.\n\n<current_html>\n${opts.currentHtml.slice(0, 80_000)}\n</current_html>`
    : `There is no page yet — design it from scratch.`;

  const task = [
    `Project: "${opts.siteName}" — a ${opts.kind === "landing" ? "landing page" : "website page"} titled "${opts.pageTitle}".`,
    "",
    context,
    "",
    `User request: ${opts.instruction}`,
    "",
    "CRAFT BAR (non-negotiable): this page must look like a top-tier product launch site, not a template —",
    "a bold hero with disciplined type scale (one display statement, generous whitespace), consistent spacing",
    "rhythm, scroll-reveal animations via a small inline IntersectionObserver script (transform/opacity only,",
    "respect prefers-reduced-motion), hover states on interactive elements, and a single restrained accent",
    "system. No lorem ipsum, no emoji noise, no generic stock-photo look.",
    "",
    "AI IMAGERY: where the design needs imagery, output an <img> tag with NO src and a data-prism attribute",
    'containing a detailed image-generation prompt, e.g. <img data-prism="cinematic dark hero of …" alt="…"',
    'style="…">. Use AT MOST 3 such images (hero first). The backend generates them and embeds the real',
    "images before the user sees the page — never reference external image URLs.",
    opts.instruction.match(/video|film|motion|animation/i)
      ? 'AI VIDEO: you may include AT MOST ONE <video data-prism-video="<detailed 8s cinematic prompt>" autoplay muted loop playsinline style="…"></video> where a moving hero earns it.'
      : "Do not include <video data-prism-video> elements unless the user asks for video.",
    "",
    "Return ONLY the complete self-contained HTML document (no prose, no code fences).",
  ].join("\n") + (await brandTaskSuffix(opts.scopeUserId ?? ""));

  // Stream (page HTML can be large) where the engine supports it.
  const result = await generateText({
    system: def.systemPrompt,
    messages: [{ role: "user", content: task }],
    tier: def.model,
    maxTokens: 32000,
    onDelta: opts.onDelta,
    label: "builder:page",
  });
  if (result.truncated) {
    throw new Error("The page was too large to finish in one pass — ask for a simpler page or split it into sections.");
  }
  const html = cleanHtml(result.text);
  if (!html || !/<html[\s>]/i.test(html)) {
    throw new Error("The designer didn't return a valid HTML document — try rephrasing the request.");
  }
  // NOTE: media placeholders are realised by the CALLER via
  // realiseGeneratedMedia() — it can take minutes (video) and callers want to
  // report that phase separately.
  // Journal the build turn so the designer can learn from it in its dream cycle —
  // workspace builds only; beta users' sites stay out of the agent's memory.
  if (!opts.scopeUserId) {
    journal("web-designer-agent", {
      kind: "run",
      reportKind: "site_build",
      task: `${opts.siteName} / ${opts.pageTitle}: ${opts.instruction.slice(0, 600)}`,
      excerpt: `Returned a ${Math.round(html.length / 1024)}kB HTML document.`,
    });
  }
  return html;
}

/**
 * Realise the designer's media placeholders: <img data-prism="prompt"> becomes
 * a Nano Banana image inlined as a data URI (pages stay self-contained and
 * publicly servable at /s/<slug> with no auth'd asset routes); one optional
 * <video data-prism-video="prompt"> becomes a Veo 3.1 clip the same way.
 * Failures degrade to a styled gradient block — visible, never a broken tag.
 */
export async function realiseGeneratedMedia(html: string, scopeUserId = ""): Promise<string> {
  let out = html;

  // Images (≤3, generated in sequence to be kind to quotas).
  const imgMatches = [...out.matchAll(/<img\b[^>]*\bdata-prism="([^"]+)"[^>]*>/gi)].slice(0, 3);
  for (const m of imgMatches) {
    const tag = m[0];
    const prompt = m[1];
    try {
      const { geminiImage } = await import("@/lib/gemini");
      const img = await geminiImage(`${prompt}. High-end web hero/section imagery, no text in image.`);
      const dataUri = `data:${img.mime};base64,${img.buffer.toString("base64")}`;
      const replaced = tag.replace(/\bdata-prism="[^"]*"\s*/i, "").replace(/<img\b/i, `<img src="${dataUri}"`);
      out = out.replace(tag, replaced);
    } catch (err) {
      console.error("[builder] image generation failed:", err instanceof Error ? err.message : err);
      out = out.replace(
        tag,
        `<div style="width:100%;aspect-ratio:16/9;border-radius:16px;background:linear-gradient(135deg,#1b1b27,#2a2140);"></div>`
      );
    }
  }
  // Any leftover placeholders beyond the cap → quiet gradient blocks.
  out = out.replace(/<img\b[^>]*\bdata-prism="[^"]*"[^>]*>/gi, `<div style="width:100%;aspect-ratio:16/9;border-radius:16px;background:linear-gradient(135deg,#1b1b27,#2a2140);"></div>`);

  // One optional video (Seedance primary, Veo backup — a few minutes; capped
  // at ~3.5 so the request survives).
  const vid = out.match(/<video\b[^>]*\bdata-prism-video="([^"]+)"[^>]*>(?:<\/video>)?/i);
  if (vid) {
    try {
      // Hero videos draw from the same monthly allowance as ad clips; once
      // it's spent the page degrades to the gradient block below.
      const { assertVideoQuota } = await import("@/lib/quota");
      await assertVideoQuota(1);
      const videoPrompt = `${vid[1]}. Cinematic, premium, no text, seamless mood.`;
      let buffer: Buffer | null = null;
      let engine = "veo";
      const { falConnected, falVideo, planVideoEngine } = await import("@/lib/fal");
      if (await falConnected()) {
        try {
          buffer = await falVideo(videoPrompt, undefined, 8, "16:9");
          engine = planVideoEngine();
        } catch (err) {
          console.error("[builder] fal engine failed, falling back to Veo:", err instanceof Error ? err.message : err);
        }
      }
      if (!buffer) {
        const { startVeoVideo, veoStatus } = await import("@/lib/gemini");
        const op = await startVeoVideo(videoPrompt, undefined, "16:9");
        const deadline = Date.now() + 210_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 12_000));
          const status = await veoStatus(op);
          if (status.done) {
            if (status.buffer) buffer = status.buffer;
            break;
          }
        }
      }
      if (!buffer) throw new Error("video render didn't finish in time");
      const { meterUsage } = await import("@/lib/events");
      meterUsage(scopeUserId, "video_gen", 1, { engine, kind: "site" });
      const dataUri = `data:video/mp4;base64,${buffer.toString("base64")}`;
      const replaced = vid[0]
        .replace(/\bdata-prism-video="[^"]*"\s*/i, "")
        .replace(/<video\b/i, `<video src="${dataUri}"`);
      out = out.replace(vid[0], replaced.endsWith("</video>") ? replaced : `${replaced}</video>`);
    } catch (err) {
      console.error("[builder] video generation failed:", err instanceof Error ? err.message : err);
      out = out.replace(
        vid[0],
        `<div style="width:100%;aspect-ratio:16/9;border-radius:16px;background:linear-gradient(135deg,#141420,#231a38);"></div>`
      );
    }
  }
  return out;
}

/**
 * The newsletter designer: same designer agent, EMAIL constraints. Emails are
 * a hostile rendering target — the rules below are what keep the design intact
 * in Gmail/Outlook/Apple Mail. Iterative like the site builder: each call
 * amends the current design.
 */
export async function generateEmail(opts: {
  instruction: string;
  currentHtml: string;
  scopeUserId?: string;
}): Promise<string> {
  const def = await loadAgentDefinition("web-designer-agent");

  const context = opts.currentHtml.trim()
    ? `This is the CURRENT email design. Apply the request and keep everything else intact; return the COMPLETE updated email HTML.\n\n<current_email>\n${opts.currentHtml.slice(0, 60_000)}\n</current_email>`
    : "There is no design yet — create it from scratch.";

  const task = [
    "Design an HTML EMAIL (not a web page). Hard rules — email clients are unforgiving:",
    "- All styles INLINE (style attributes). No <style> blocks relied on for layout, no external CSS, no JavaScript.",
    "- Table-based or single-column layout, max 640px wide, centred, generous padding.",
    "- System font stacks only. No external images or fonts (emails must be self-contained); build visual interest from colour, spacing and typography.",
    "- Must read well in dark and light mail clients: no pure-white-on-white or black-on-black assumptions.",
    "- Include exactly one clear call-to-action button (a padded <a> with inline styles).",
    "- Return ONLY the complete HTML document (no prose, no code fences).",
    "",
    context,
    "",
    `Design request: ${opts.instruction}`,
  ].join("\n") + (await brandTaskSuffix(opts.scopeUserId ?? ""));

  const result = await generateText({
    system: def.systemPrompt,
    messages: [{ role: "user", content: task }],
    tier: def.model,
    maxTokens: 24000,
    label: "builder:email",
  });
  if (result.truncated) {
    throw new Error("The design ran too long — ask for something simpler and build it up in steps.");
  }
  const html = cleanHtml(result.text);
  if (!html || !/<html[\s>]/i.test(html)) {
    throw new Error("The designer didn't return a valid email — try rephrasing the request.");
  }
  return html;
}
