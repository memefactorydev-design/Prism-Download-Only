import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canTouch, getSessionUser } from "@/lib/auth";
import { SiteBuilder, type BuilderData } from "@/components/SiteBuilder";

export const dynamic = "force-dynamic";

export default async function SiteBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const site = await db.site.findUnique({
    where: { id },
    include: {
      pages: { orderBy: { order: "asc" } },
      messages: { orderBy: { createdAt: "asc" }, take: 100 },
    },
  });
  if (!site || !canTouch(site, user)) notFound();

  const data: BuilderData = {
    id: site.id,
    name: site.name,
    slug: site.slug,
    kind: site.kind,
    status: site.status,
    publishedUrl: site.publishedUrl,
    pages: site.pages.map((p) => ({
      id: p.id,
      path: p.path,
      isHome: p.isHome,
      title: p.title,
      html: p.html,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
    })),
    messages: site.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, pageId: m.pageId })),
  };
  return <SiteBuilder data={data} />;
}
