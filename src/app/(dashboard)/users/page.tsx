import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { UsersBoard } from "@/components/UsersBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getSessionUser();
  if (!me || me.role !== "admin") redirect("/");
  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });
  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Team access"
        subtitle="Admins see everything. Members get the creation tools — Studio, Director, Templates, Calendar drafting, Media — but never credentials, ad spend, revenue, reports, or publish/spend approvals."
      />
      <UsersBoard
        me={{ id: me.id }}
        users={users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt.toISOString() }))}
      />
    </div>
  );
}
