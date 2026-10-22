import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser, scopeWhere } from "@/lib/auth";
import { MediaLibrary } from "@/components/MediaLibrary";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const media = await db.mediaAsset.findMany({ where: scopeWhere(user), orderBy: { createdAt: "desc" } });
  return (
    <div>
      <PageHeader
        title="Media library"
        subtitle={`Your creative library (${media.length} stored). Upload the clips and shots your posts will use — everything here drops straight into posts, reels and ads, and nothing leaves until a post you approved goes out.`}
      />
      <div>
        <MediaLibrary
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
