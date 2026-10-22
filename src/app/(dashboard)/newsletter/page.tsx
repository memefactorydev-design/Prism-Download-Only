import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser, scopeWhere } from "@/lib/auth";
import { getConnectionStatuses } from "@/lib/connections";
import { NewsletterBoard, type NewsletterDTO } from "@/components/NewsletterBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function NewsletterPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [newsletters, connections] = await Promise.all([
    db.newsletter.findMany({ where: scopeWhere(user), orderBy: { createdAt: "desc" }, take: 50 }),
    getConnectionStatuses(user.id, user.role),
  ]);

  const dto: NewsletterDTO[] = newsletters.map((n) => ({
    id: n.id,
    subject: n.subject,
    bodyHtml: n.bodyHtml,
    status: n.status,
    audience: n.audience,
    sentCount: n.sentCount,
    failedCount: n.failedCount,
    sentAt: n.sentAt?.toISOString() ?? null,
    errorMessage: n.errorMessage,
    createdAt: n.createdAt.toISOString(),
  }));

  const smtp = connections.find((c) => c.provider === "smtp");

  return (
    <div>
      <PageHeader
        title="Newsletter"
        subtitle="Write it (or let the writer draft it), pick the audience from your leads, and send through your own email — every issue carries a one-click unsubscribe automatically."
      />
      <NewsletterBoard initial={dto} smtpConnected={smtp?.status === "connected"} />
    </div>
  );
}
