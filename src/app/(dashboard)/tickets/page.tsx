// Admin-only: the support queue Iris feeds. Guard pattern mirrors /users.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { TicketsBoard } from "@/components/TicketsBoard";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return (
    <div>
      <PageHeader
        title="Support tickets"
        subtitle="Everything Iris couldn't resolve in chat lands here. Resolve with a note — the member sees it the next time they open Iris."
      />
      <TicketsBoard />
    </div>
  );
}
