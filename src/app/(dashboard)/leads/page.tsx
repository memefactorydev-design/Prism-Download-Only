import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser, scopeWhere } from "@/lib/auth";
import { LeadsBoard, type LeadDTO } from "@/components/LeadsBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const leads = await db.lead.findMany({
    where: scopeWhere(user),
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const dto: LeadDTO[] = leads.map((l) => ({
    id: l.id,
    name: l.name,
    email: l.email,
    phone: l.phone,
    company: l.company,
    source: l.source,
    detail: l.detail,
    score: l.score,
    scoreReason: l.scoreReason,
    status: l.status,
    subscribed: l.subscribed,
    createdAt: l.createdAt.toISOString(),
  }));

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Every enquiry in one pipeline — scored for quality the moment it arrives, deep-scored by AI on demand. Drag between stages or work the list, and your website forms and AI agents feed new enquiries straight in."
      />
      <LeadsBoard initialLeads={dto} />
    </div>
  );
}
