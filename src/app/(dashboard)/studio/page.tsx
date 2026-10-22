import { redirect } from "next/navigation";
import { listJobs } from "@/lib/studio";
import { falConnected } from "@/lib/fal";
import { recentTrendInsights } from "@/lib/trends";
import { recentTemplates } from "@/lib/templates";
import { getSessionUser } from "@/lib/auth";
import { StudioBoard, type JobDTO, type TemplateOption } from "@/components/StudioBoard";
import { TrendResearch, type InsightDTO } from "@/components/TrendResearch";
import { PageHeader } from "@/components/ui/PageHeader";
import { StudioTabs } from "@/components/StudioTabs";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [jobs, trends, templates, falEnabled] = await Promise.all([
    listJobs(user),
    recentTrendInsights(user),
    recentTemplates(user),
    falConnected().catch(() => false),
  ]);
  const templateOptions: TemplateOption[] = templates.map((t) => ({ id: t.id, title: t.title }));
  const initialInsights: InsightDTO[] = trends.map((t) => ({
    id: t.id,
    platform: t.platform,
    topic: t.topic,
    rank: t.rank,
    title: t.title,
    hook: t.hook,
    format: t.format,
    pacing: t.pacing,
    sound: t.sound,
    whyItWorks: t.whyItWorks,
    evidence: t.evidence,
    score: t.score,
  }));
  const initialJobs: JobDTO[] = jobs.map(({ job, source, clips }) => ({
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    outputKinds: job.outputKinds,
    mode: job.mode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    sourceName: source?.originalName ?? null,
    sourceAssetId: job.sourceAssetId,
    clips: clips.map((c) => ({
      id: c.id,
      kind: c.kind,
      rank: c.rank,
      title: c.title,
      hook: c.hook,
      caption: c.caption,
      status: c.status,
      assetId: c.assetId,
      errorMessage: c.errorMessage,
      viralityScore: c.viralityScore,
      viralityRationale: c.viralityRationale,
    })),
  }));

  return (
    <div>
      <PageHeader
        title="Studio"
        subtitle="Drop raw footage and the AI cuts it into ranked, captioned short-form reels — or mix several videos into a montage. Download a clip or send it straight to your Calendar."
      />
      <StudioTabs
        create={
          <StudioBoard
            initialJobs={initialJobs}
            falEnabled={falEnabled}
            templates={templateOptions}
            trendChips={initialInsights.slice(0, 6).map((i) => ({ id: i.id, title: i.title, platform: i.platform }))}
          />
        }
        trends={<TrendResearch initialInsights={initialInsights} />}
      />
    </div>
  );
}
