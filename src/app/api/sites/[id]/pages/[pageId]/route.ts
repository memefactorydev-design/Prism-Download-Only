import { db } from "@/lib/db";
import { canTouch, getSessionUser } from "@/lib/auth";

// The page must belong to the site in the URL, and that site to the caller's scope.
async function guardPage(siteId: string, pageId: string): Promise<Response | null> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const page = await db.page.findUnique({ where: { id: pageId }, include: { site: true } });
  if (!page || page.siteId !== siteId || !canTouch(page.site, user)) {
    return Response.json({ error: "Page not found." }, { status: 404 });
  }
  return null;
}

// Update a page's SEO fields, title, or (manually edited) HTML.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id, pageId } = await params;
  const guard = await guardPage(id, pageId);
  if (guard) return guard;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    html?: string;
    seoTitle?: string;
    seoDescription?: string;
    seoKeywords?: string;
    jsonLd?: string;
  };
  const page = await db.page.update({
    where: { id: pageId },
    data: {
      title: body.title,
      html: body.html,
      seoTitle: body.seoTitle,
      seoDescription: body.seoDescription,
      seoKeywords: body.seoKeywords,
      jsonLd: body.jsonLd,
    },
  });
  return Response.json({ id: page.id });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id, pageId } = await params;
  const guard = await guardPage(id, pageId);
  if (guard) return guard;
  const page = await db.page.findUnique({ where: { id: pageId } });
  if (page?.isHome) return Response.json({ error: "Can't delete the home page." }, { status: 400 });
  await db.page.delete({ where: { id: pageId } });
  return Response.json({ ok: true });
}
