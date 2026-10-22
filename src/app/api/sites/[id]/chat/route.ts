// Generate/edit a page via the web-designer-agent (Opus), STREAMING progress:
// the response is NDJSON — {"type":"progress","html":…} lines as the designer
// writes (so the builder preview grows live), then a final {"type":"done"}
// with the persisted page (AI imagery realised) or {"type":"error"}.

import { db } from "@/lib/db";
import { generatePage, realiseGeneratedMedia } from "@/lib/builder";
import { canTouch, getSessionUser } from "@/lib/auth";

export const maxDuration = 300;

// Best-effort visible fragment from a partial document: strip fences, close
// nothing — browsers render partial HTML fine in an iframe.
function partialHtml(raw: string): string | null {
  const cleaned = raw.replace(/^```(?:html)?\s*/i, "");
  const start = cleaned.search(/<!doctype html>|<html[\s>]/i);
  if (start === -1) return null;
  return cleaned.slice(start);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { message?: string; pageId?: string };
  const message = body.message?.trim();
  if (!message) return Response.json({ error: "Type what you'd like to build or change." }, { status: 400 });

  const site = await db.site.findUnique({ where: { id }, include: { pages: { orderBy: { order: "asc" } } } });
  if (!site || !canTouch(site, user)) return Response.json({ error: "Site not found." }, { status: 404 });
  const page = body.pageId ? site.pages.find((p) => p.id === body.pageId) : site.pages.find((p) => p.isHome) ?? site.pages[0];
  if (!page) return Response.json({ error: "Page not found." }, { status: 404 });

  await db.builderMessage.create({ data: { siteId: id, pageId: page.id, role: "user", content: message } });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      let lastSent = 0;
      try {
        const html = await generatePage({
          instruction: message,
          currentHtml: page.html,
          siteName: site.name,
          pageTitle: page.title,
          kind: site.kind,
          scopeUserId: site.userId,
          onDelta: (acc) => {
            // Throttle progress frames — the preview doesn't need every token.
            const now = Date.now();
            if (now - lastSent < 700) return;
            const partial = partialHtml(acc);
            if (partial) {
              lastSent = now;
              send({ type: "progress", html: partial });
            }
          },
        });
        let finalHtml = html;
        if (/data-prism(-video)?="/.test(html)) {
          send({ type: "progress", html: partialHtml(html) ?? html });
          send({ type: "media", note: "Design done — generating the imagery…" });
          finalHtml = await realiseGeneratedMedia(html, site.userId);
        }
        await db.page.update({ where: { id: page.id }, data: { html: finalHtml } });
        await db.builderMessage.create({
          data: { siteId: id, pageId: page.id, role: "assistant", content: page.html ? "Updated the page." : "Built the first version of the page." },
        });
        send({ type: "done", html: finalHtml, pageId: page.id });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.builderMessage
          .create({ data: { siteId: id, pageId: page.id, role: "assistant", content: `⚠️ ${msg}` } })
          .catch(() => {});
        send({ type: "error", error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
