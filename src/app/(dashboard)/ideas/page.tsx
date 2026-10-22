import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser, scopeWhere } from "@/lib/auth";
import { IdeasBoard } from "@/components/IdeasBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [ideas, latestReport] = await Promise.all([
    db.adIdea.findMany({
      where: { status: { not: "archived" }, ...scopeWhere(user) },
      orderBy: [{ createdAt: "desc" }, { rank: "asc" }],
    }),
    // Research reports are workspace artefacts — admin-only on this page.
    user.role === "admin"
      ? db.agentReport.findFirst({
          where: { agentName: "ad-research-agent", kind: "research_brief" },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        title="Winning Ads"
        subtitle="What's actually working in your market — ranked ad concepts distilled from ads that keep spending, weighted by your own revenue history. Every brief is honest about what the research could and couldn't see."
      />
      <div>
        <IdeasBoard
          ideas={ideas.map((i) => ({
            id: i.id,
            rank: i.rank,
            title: i.title,
            hook: i.hook,
            format: i.format,
            targetAudience: i.targetAudience,
            evidence: i.evidence,
            brandAngle: i.brandAngle,
            status: i.status,
            createdAt: i.createdAt.toISOString(),
          }))}
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
