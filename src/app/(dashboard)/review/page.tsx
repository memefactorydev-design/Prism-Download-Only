import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser, scopeOf, scopeWhere } from "@/lib/auth";
import { getBrandProfile } from "@/lib/brand-profile";
import { ReviewBoard, type ReviewPost } from "@/components/ReviewBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Everything the AI team has made, newest stages first — not just the
  // approval queue. The board filters by stage client-side.
  const posts = await db.post.findMany({
    where: { ...scopeWhere(user) },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    take: 200,
    include: { media: true },
  });

  // The replica chrome wears the member's real brand.
  const profile = await getBrandProfile(scopeOf(user));
  const name = profile?.businessName || "Your brand";
  const brand = {
    name,
    handle: name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "yourbrand",
  };

  const dto: ReviewPost[] = posts.map((p) => ({
    id: p.id,
    channel: p.channel,
    format: p.format,
    status: p.status,
    title: p.title,
    body: p.body,
    hashtags: p.hashtags,
    scheduledFor: p.scheduledFor?.toISOString() ?? null,
    media: p.media.map((m) => ({ id: m.id, mimeType: m.mimeType })),
    refractionGroup: p.refractionGroup,
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <div>
      <PageHeader
        title="Review"
        subtitle="Every post your AI team has made, shown exactly as the platform will show it. Approve what's waiting, browse what's coming — nothing publishes without your yes."
      />
      <ReviewBoard initial={dto} brand={brand} />
    </div>
  );
}
