import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getConnectionStatuses } from "@/lib/connections";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { engineReady } from "@/lib/llm";
import { OverviewHome } from "@/components/OverviewHome";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [connections, research, templates, clips, posts, openTickets, mindReady, profile] = await Promise.all([
    getConnectionStatuses(user.id, user.role), // members see THEIR postiz/meta status
    db.trendInsight.count(),
    db.contentTemplate.count(),
    db.generatedClip.count({ where: { status: "rendered" } }),
    db.post.count(user.role === "admin" ? undefined : { where: { userId: user.id } }),
    user.role === "admin" ? db.supportTicket.count({ where: { status: "open" } }) : Promise.resolve(0),
    engineReady(),
    db.brandProfile.findUnique({ where: { userId: scopeOf(user) }, select: { id: true } }),
  ]);

  return (
    <OverviewHome
      connections={connections.map((c) => ({ provider: c.provider, status: c.status }))}
      stats={{ research, templates, clips, posts, openTickets }}
      isAdmin={user.role === "admin"}
      engineReady={mindReady}
      brandMissing={!profile}
    />
  );
}
