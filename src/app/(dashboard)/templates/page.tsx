import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { recentTemplates } from "@/lib/templates";
import { TemplatesBoard, type TemplateItem } from "@/components/TemplatesBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

function parse(json: string): Record<string, string> {
  try {
    return JSON.parse(json) as Record<string, string>;
  } catch {
    return {};
  }
}

export default async function TemplatesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [templates, latestReport] = await Promise.all([
    recentTemplates(user),
    // Research reports are workspace artefacts — admin-only on this page.
    user.role === "admin"
      ? db.agentReport.findFirst({
          where: { agentName: "template-research-agent", kind: "template_research" },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve(null),
  ]);

  const items: TemplateItem[] = templates.map((t) => ({
    id: t.id,
    niche: t.niche,
    rank: t.rank,
    title: t.title,
    format: t.format,
    blueprint: t.blueprint,
    hook: t.hook,
    whyItWorks: t.whyItWorks,
    captions: parse(t.captions),
    hashtags: parse(t.hashtags),
    youtubeTitle: t.youtubeTitle,
    evidence: t.evidence,
    score: t.score,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
  }));

  return (
    <div>
      <PageHeader
        title="Templates"
        subtitle="Viral video formats, decoded. We study the top-performing short-form content in any niche and break each hit down into a step-by-step blueprint — shots, timing, text and sound — with ready-to-post captions and hashtags for every channel. Recreate them with your own footage in Studio or CapCut."
      />
      <div>
        <TemplatesBoard
          templates={items}
          latestReport={
            latestReport
              ? {
                  id: latestReport.id,
                  title: latestReport.title,
                  content: latestReport.content,
                  createdAt: latestReport.createdAt.toISOString(),
                }
              : null
          }
        />
      </div>
    </div>
  );
}
