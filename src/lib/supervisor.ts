// Supervisor reporting (Phase 6): gather the week's facts from every
// subsystem — content, media, ads, research, SEO, connection health — and hand
// them to marketing-supervisor (opus) to write the weekly report. The
// supervisor never executes anything; it aggregates, diagnoses and recommends,
// tagging actions [needs approval] vs [safe to execute].

import type { AgentReport } from "@prisma/client";
import { getCampaignAggregates } from "@/lib/ads";
import { runAgent } from "@/lib/agents/run-agent";
import { getConnectionStatuses } from "@/lib/connections";
import { db } from "@/lib/db";

const REPORT_EXCERPT_CHARS = 4_000;

export async function runWeeklyReport(): Promise<{ report: AgentReport }> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [posts, mediaCount, adApprovals, ideas, recentReports, connections, campaigns] =
    await Promise.all([
      db.post.findMany({
        where: { updatedAt: { gte: weekAgo } },
        include: { media: true },
        orderBy: { updatedAt: "desc" },
      }),
      db.mediaAsset.count({ where: { createdAt: { gte: weekAgo } } }),
      db.approval.findMany({
        where: { kind: "ad_budget", OR: [{ createdAt: { gte: weekAgo } }, { status: "pending" }] },
        orderBy: { createdAt: "desc" },
      }),
      db.adIdea.findMany({ where: { status: { not: "archived" } }, orderBy: { rank: "asc" } }),
      db.agentReport.findMany({
        where: { agentName: { not: "marketing-supervisor" }, createdAt: { gte: weekAgo } },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      getConnectionStatuses(),
      getCampaignAggregates(),
    ]);

  const postSummary = posts.map((p) => ({
    channel: p.channel,
    status: p.status,
    scheduledFor: p.scheduledFor?.toISOString() ?? null,
    mediaCount: p.media.length,
    excerpt: p.body.slice(0, 120),
    error: p.errorMessage,
  }));

  const approvalSummary = adApprovals.map((a) => {
    const payload = JSON.parse(a.payload) as {
      action?: string;
      campaignName?: string;
      execution?: { status: string; message: string };
    };
    return {
      status: a.status,
      action: payload.action,
      campaign: payload.campaignName,
      execution: payload.execution ?? null,
    };
  });

  const task = [
    `Produce the weekly marketing report for the 7 days ending ${new Date().toISOString().slice(0, 10)}.`,
    "",
    "All data below was gathered by the backend from the command centre's own records. Where a",
    "subsystem has no data, that usually means it is not yet connected or was not used — report",
    "that honestly in the Blocked/caveats section rather than inventing activity.",
    "",
    "### Service connections",
    "```json",
    JSON.stringify(
      connections.map((c) => ({ provider: c.provider, status: c.status, metadata: c.metadata })),
      null,
      2
    ),
    "```",
    "",
    `### Content (posts touched this week: ${posts.length}; media files uploaded: ${mediaCount})`,
    "```json",
    JSON.stringify(postSummary, null, 2),
    "```",
    "",
    `### Meta ads — campaign aggregates, trailing 30 days (${campaigns.length} campaigns)`,
    "```json",
    JSON.stringify(campaigns, null, 2),
    "```",
    "",
    `### Ad recommendations / approvals (this week + still pending)`,
    "```json",
    JSON.stringify(approvalSummary, null, 2),
    "```",
    "",
    `### Active ad ideas from research (${ideas.length})`,
    "```json",
    JSON.stringify(
      ideas.map((i) => ({ rank: i.rank, title: i.title, status: i.status })),
      null,
      2
    ),
    "```",
    "",
    `### Specialist agent reports filed this week (${recentReports.length}, excerpted)`,
    ...recentReports.flatMap((r) => [
      `#### ${r.agentName} — ${r.title} (${r.createdAt.toISOString().slice(0, 10)})`,
      r.content.slice(0, REPORT_EXCERPT_CHARS),
      "",
    ]),
    "Write the full weekly report in your specified 7-section format. Engagement metrics for",
    "published posts are NOT collected by this app yet — list that as a known gap, don't estimate.",
    "Your FINAL reply must be ONLY the complete markdown report, no preamble.",
  ].join("\n");

  const { report } = await runAgent("marketing-supervisor", task, {
    reportKind: "weekly_report",
    reportTitle: `Weekly report — w/e ${new Date().toISOString().slice(0, 10)}`,
  });
  return { report };
}
