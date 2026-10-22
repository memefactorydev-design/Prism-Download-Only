import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { listPosts } from "@/lib/posts";
import { getSessionUser, scopeWhere } from "@/lib/auth";
import { CalendarBoard } from "@/components/CalendarBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [posts, media] = await Promise.all([
    listPosts(user), // members see their own sandbox; the admin sees everything
    db.mediaAsset.findMany({ where: scopeWhere(user), orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Content calendar"
        subtitle="Draft → submit → approve → scheduled to your channels. Nothing is published without your explicit approval."
      />
      <div>
        <CalendarBoard
          posts={posts.map((p) => ({
            id: p.id,
            channel: p.channel,
            format: p.format,
            title: p.title,
            status: p.status,
            body: p.body,
            hashtags: p.hashtags,
            scheduledFor: p.scheduledFor?.toISOString() ?? null,
            errorMessage: p.errorMessage,
            postizPostId: p.postizPostId,
            media: p.media.map((m) => ({
              id: m.id,
              originalName: m.originalName,
              mimeType: m.mimeType,
              sizeBytes: m.sizeBytes,
              createdAt: m.createdAt.toISOString(),
            })),
          }))}
          media={media.map((m) => ({
            id: m.id,
            originalName: m.originalName,
            mimeType: m.mimeType,
            sizeBytes: m.sizeBytes,
            createdAt: m.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
