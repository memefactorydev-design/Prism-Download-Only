import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser, scopeWhere } from "@/lib/auth";
import { DirectorList, type ProjectListItem, type VideoAssetOption } from "@/components/DirectorList";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function DirectorPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [projects, videos] = await Promise.all([
    db.fableProject.findMany({
      where: scopeWhere(user),
      orderBy: { updatedAt: "desc" },
      include: { sources: true, revisions: { orderBy: { number: "desc" }, take: 1 } },
    }),
    db.mediaAsset.findMany({
      where: { OR: [{ mimeType: { startsWith: "video/" } }, { mimeType: { startsWith: "image/" } }], ...scopeWhere(user) },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
  ]);

  const items: ProjectListItem[] = projects.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    sourceCount: p.sources.length,
    latestRevision: p.revisions[0] ? `Rev ${p.revisions[0].number} · ${p.revisions[0].quality}` : null,
    updatedAt: p.updatedAt.toISOString(),
  }));
  const assetOptions: VideoAssetOption[] = videos.map((v) => ({
    id: v.id,
    name: v.originalName,
    durationSecs: v.durationSecs,
    isPhoto: v.mimeType.startsWith("image/"),
  }));

  return (
    <div>
      <PageHeader
        eyebrow="AI video editor"
        title="Director"
        subtitle="Pick footage, describe the video you want in plain English, and the Director cuts it: scenes across sources, captions, emoji pops, effects, music and studio voice-over, grounded in your live trend research and ad ideas. Iterate by chat; render drafts fast, finalise in 1080p."
      />
      <DirectorList projects={items} videoAssets={assetOptions} />
    </div>
  );
}
