import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser, scopeWhere } from "@/lib/auth";
import { SeoWorkspace } from "@/components/SeoWorkspace";
import type { SeoData, SeoReport } from "@/components/SeoHub";
import type { DraftRow } from "@/components/ContentBoard";
import type { GbpReport } from "@/components/GbpBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

function parse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export default async function SeoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const seoKind = user.role === "admin" ? "seo_audit" : `seo_audit:${user.id}`;
  const gbpKind = user.role === "admin" ? "gbp_research" : `gbp_research:${user.id}`;
  const [seoReports, drafts, gbpReports] = await Promise.all([
    db.agentReport.findMany({ where: { agentName: "seo-geo-agent", kind: seoKind }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.contentDraft.findMany({ where: scopeWhere(user), orderBy: { createdAt: "desc" }, take: 30 }),
    db.agentReport.findMany({ where: { agentName: "gbp-agent", kind: gbpKind }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const audit: SeoReport[] = seoReports.map((r) => ({
    id: r.id, title: r.title, content: r.content, createdAt: r.createdAt.toISOString(), data: parse<SeoData>(r.data),
  }));
  const draftRows: DraftRow[] = drafts.map((d) => ({
    id: d.id, kind: d.kind, title: d.title, slug: d.slug, bodyHtml: d.bodyHtml, excerpt: d.excerpt,
    seoTitle: d.seoTitle, seoDescription: d.seoDescription, keywords: d.keywords, jsonLd: d.jsonLd,
    status: d.status, publishedUrl: d.publishedUrl, createdAt: d.createdAt.toISOString(),
  }));
  const gbp: GbpReport[] = gbpReports.map((r) => ({
    id: r.id, title: r.title, createdAt: r.createdAt.toISOString(), data: parse<GbpReport["data"]>(r.data),
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Growth"
        title="SEO / GEO"
        subtitle="Audit and rank higher across Google organic, Google Business Profile and LLM answers (GEO) — with a website audit, an SEO/GEO content generator, and a local Google Business optimiser."
      />
      <SeoWorkspace audit={audit} drafts={draftRows} gbp={gbp} />
    </div>
  );
}
