// Download a page's HTML as a self-contained file.
import { db } from "@/lib/db";
import { canTouch, getSessionUser } from "@/lib/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Not signed in.", { status: 401 });
  const { id } = await params;
  const pageId = new URL(request.url).searchParams.get("pageId");
  const site = await db.site.findUnique({ where: { id }, include: { pages: { orderBy: { order: "asc" } } } });
  if (!site || !canTouch(site, user)) return new Response("Site not found.", { status: 404 });
  const page = pageId ? site.pages.find((p) => p.id === pageId) : site.pages.find((p) => p.isHome) ?? site.pages[0];
  if (!page || !page.html) return new Response("Nothing to export yet.", { status: 404 });
  const filename = `${site.slug}${page.isHome ? "" : "-" + page.path.replace(/\//g, "")}.html`;
  return new Response(page.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
