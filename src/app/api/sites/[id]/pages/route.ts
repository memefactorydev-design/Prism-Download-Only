import { db } from "@/lib/db";
import { canTouch, getSessionUser } from "@/lib/auth";

// Add a page to a site.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await db.site.findUnique({ where: { id } });
  if (!site || !canTouch(site, user)) return Response.json({ error: "Site not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { path?: string; title?: string };
  let path = (body.path ?? "").trim();
  if (!path.startsWith("/")) path = "/" + path;
  path = path.replace(/\/+$/g, "") || "/";
  if (path === "/") return Response.json({ error: "Use a sub-path like /pricing (the home page already exists)." }, { status: 400 });

  const existing = await db.page.findFirst({ where: { siteId: id, path } });
  if (existing) return Response.json({ error: `A page at ${path} already exists.` }, { status: 400 });

  const count = await db.page.count({ where: { siteId: id } });
  const page = await db.page.create({
    data: { siteId: id, path, title: body.title?.trim() || path.slice(1), order: count, html: "" },
  });
  return Response.json({ id: page.id });
}
