import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser, scopeWhere } from "@/lib/auth";
import { SitesList, type SiteRow } from "@/components/SitesList";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const sites = await db.site.findMany({
    where: scopeWhere(user),
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { pages: true } } },
  });
  const rows: SiteRow[] = sites.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    kind: s.kind,
    status: s.status,
    publishedUrl: s.publishedUrl,
    pageCount: s._count.pages,
    updatedAt: s.updatedAt.toISOString(),
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Website builder"
        title="Sites"
        subtitle="Build world-class, high-converting websites and landing pages with your AI designer — chat to design, preview live, then publish in-app, to WordPress, or over FTP."
      />
      <SitesList sites={rows} />
    </div>
  );
}
