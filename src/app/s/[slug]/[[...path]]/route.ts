// Public hosting for in-app-published sites: serves a Site page's publishedHtml
// as raw text/html at /s/<slug> (home) and /s/<slug>/<path>. No auth — these are
// meant to be publicly reachable when the app is deployed.

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> }
): Promise<Response> {
  const { slug, path } = await params;
  const site = await db.site.findUnique({ where: { slug }, include: { pages: true } });
  if (!site) return new Response("Site not found.", { status: 404 });

  const requested = path && path.length ? `/${path.join("/")}` : "/";
  const page =
    requested === "/"
      ? site.pages.find((p) => p.isHome) ?? site.pages.find((p) => p.path === "/") ?? site.pages[0]
      : site.pages.find((p) => p.path === requested);

  if (!page || !page.publishedHtml) {
    return new Response("This page hasn't been published yet.", { status: 404 });
  }
  return new Response(page.publishedHtml, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
