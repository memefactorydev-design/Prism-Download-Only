import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { GenerateDeckButton } from "@/components/GenerateDeckButton";
import { PulseCard } from "@/components/PulseCard";
import type { PulseData } from "@/lib/pulse";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { dashboardKpis } from "@/lib/reports";
import { spendVsRevenue } from "@/lib/deals";
import { ReportsDashboard } from "@/components/ReportsDashboard";
import { ReportsBoard } from "@/components/ReportsBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const scope = scopeOf(user);

  const [kpis, svr, weekly, decks, pulseReport] = await Promise.all([
    dashboardKpis(scope),
    spendVsRevenue(12, scope),
    // The supervisor's weekly briefings are a workspace artefact — admin only.
    user.role === "admin"
      ? db.agentReport.findMany({
          where: { agentName: "marketing-supervisor", kind: "weekly_report" },
          orderBy: { createdAt: "desc" },
          take: 12,
        })
      : Promise.resolve([]),
    db.agentReport.findMany({
      where: { kind: scope ? `board_deck:${scope}` : "board_deck" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, title: true, createdAt: true },
    }),
    db.agentReport.findFirst({
      where: { kind: scope ? `pulse:${scope}` : "pulse" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Your marketing, measured live: spend, banked revenue, ROAS, pipeline and publishing — all in one place, updating as you work."
      />
      <PulseCard
        initial={
          pulseReport?.data
            ? { id: pulseReport.id, createdAt: pulseReport.createdAt.toISOString(), data: JSON.parse(pulseReport.data) as PulseData }
            : null
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <GenerateDeckButton />
        {decks.map((d) => (
          <Link key={d.id} href={`/reports/deck/${d.id}`} className="text-sm text-accent underline underline-offset-4">
            {d.createdAt.toLocaleDateString("en-GB")} deck
          </Link>
        ))}
      </div>

      <ReportsDashboard kpis={kpis} monthly={svr.rows.map((r) => ({ ...r }))} />

      {user.role === "admin" && weekly.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">Weekly briefings</h2>
          <ReportsBoard
            reports={weekly.map((r) => ({
              id: r.id,
              title: r.title,
              content: r.content,
              createdAt: r.createdAt.toISOString(),
            }))}
          />
        </div>
      )}
    </div>
  );
}
