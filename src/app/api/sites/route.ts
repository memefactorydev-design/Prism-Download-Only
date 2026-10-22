import { db } from "@/lib/db";
import { slugify } from "@/lib/builder";
import { getSessionUser, scopeOf, scopeWhere } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const sites = await db.site.findMany({ where: scopeWhere(user), orderBy: { updatedAt: "desc" }, include: { pages: true } });
  return Response.json({ sites });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { name?: string; kind?: string };
  const name = body.name?.trim();
  if (!name) return Response.json({ error: "Give the site a name." }, { status: 400 });
  const kind = body.kind === "site" ? "site" : "landing";

  // Unique slug (global — /s/<slug> is one public namespace across all users).
  let slug = slugify(name);
  for (let i = 2; await db.site.findUnique({ where: { slug } }); i++) slug = `${slugify(name)}-${i}`;

  const site = await db.site.create({
    data: {
      userId: scopeOf(user),
      name,
      slug,
      kind,
      pages: { create: { path: "/", isHome: true, order: 0, title: name, html: "" } },
    },
    include: { pages: true },
  });
  return Response.json({ id: site.id, slug: site.slug });
}
