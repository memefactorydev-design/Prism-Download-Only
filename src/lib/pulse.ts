// P4.3 — Prism Pulse: the learning loop, honest and live. What worked comes
// from YOUR measured data; what's rising comes from Radar's live trend briefs
// (a feed generic benchmarks can't match); and it ends in at most three
// actions, each one tap — and each one landing behind the usual approval gate,
// never a silent auto-apply.

import type { AgentReport } from "@prisma/client";
import { db } from "@/lib/db";
import { runAgent } from "@/lib/agents/run-agent";
import { dashboardKpis } from "@/lib/reports";
import { planWeek } from "@/lib/drip";
import { refractDraft } from "@/lib/refract";
import { getBrandProfile } from "@/lib/brand-profile";
import type { PostActor } from "@/lib/posts";

const PULSE_SCHEMA = {
  type: "object",
  properties: {
    worked: { type: "array", description: "3-5 bullets: what the OWN data shows worked. Cite the numbers given.", items: { type: "string" } },
    rising: { type: "array", description: "2-4 bullets: what's rising in the niche, from the trend briefs.", items: { type: "string" } },
    actions: {
      type: "array",
      description: "AT MOST 3 recommended actions, most valuable first.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", description: "draft_post | plan_stubs | ad_variant" },
          title: { type: "string", description: "Imperative, plain English — 'Post the walnut close-up angle on Instagram'." },
          why: { type: "string", description: "One line tying it to the data above." },
          channel: { type: "string", description: "For draft_post: target channel. Else ''." },
          angle: { type: "string", description: "For draft_post/ad_variant: 2-3 sentence content/creative angle. Else ''." },
        },
        required: ["kind", "title", "why", "channel", "angle"],
        additionalProperties: false,
      },
    },
  },
  required: ["worked", "rising", "actions"],
  additionalProperties: false,
};

export interface PulseAction {
  kind: string;
  title: string;
  why: string;
  channel: string;
  angle: string;
  done?: boolean;
}
export interface PulseData {
  worked: string[];
  rising: string[];
  actions: PulseAction[];
}

export async function buildPulse(scope: string): Promise<AgentReport> {
  const [kpis, trends] = await Promise.all([
    dashboardKpis(scope),
    db.trendInsight.findMany({ where: { userId: scope }, orderBy: { createdAt: "desc" }, take: 6 }),
  ]);

  const task = [
    "Write this week's PULSE: what worked (from the measured data below — cite it), what's rising (from the live trend briefs), and AT MOST three recommended actions.",
    "Honesty rules: if a section has thin data, say so rather than inventing signal. Actions must be concrete enough to execute from the angle alone.",
    "",
    "## Measured performance (trailing 30 days)",
    "```json",
    JSON.stringify(
      {
        adSpend: kpis.adSpend,
        revenue: kpis.revenue,
        blendedRoas: kpis.blendedRoas,
        leadsNew: kpis.leadsNew,
        leadConversion: kpis.leadConversion,
        postsPublished: kpis.postsPublished,
        channelPosts: kpis.channelPosts,
        topCampaigns: kpis.topCampaigns.slice(0, 4),
        social: kpis.social?.facebook
          ? { fbFollowers: kpis.social.facebook.followers, fbEngagements28d: kpis.social.facebook.engagements28d, igFollowers: kpis.social.instagram?.followers, igAvgLikes: kpis.social.instagram?.avgLikes }
          : null,
        searchClicks28d: kpis.gscClicks,
      },
      null,
      2
    ),
    "```",
    "",
    "## Live trend briefs (Radar)",
    trends.length ? trends.map((t) => `- [${t.platform}] ${t.title}: ${t.hook}`).join("\n") : "(none this week — say so in 'rising')",
  ].join("\n");

  const { report } = await runAgent<PulseData>("marketing-supervisor", task, {
    schema: PULSE_SCHEMA,
    maxTokens: 8000,
    reportKind: scope ? `pulse:${scope}` : "pulse",
    reportTitle: "Prism Pulse",
    scopeUserId: scope,
  });
  return report;
}

/** Execute one Pulse action. Everything lands behind the approval gate. */
export async function runPulseAction(reportId: string, index: number, actor: PostActor, scope: string): Promise<string> {
  const report = await db.agentReport.findUnique({ where: { id: reportId } });
  if (!report?.data || !report.kind.startsWith("pulse")) throw new Error("Pulse not found.");
  const data = JSON.parse(report.data) as PulseData;
  const action = data.actions?.[index];
  if (!action) throw new Error("That action isn't in this Pulse.");
  if (action.done) throw new Error("Already done — check your calendar.");

  let message: string;
  if (action.kind === "draft_post") {
    const profile = await getBrandProfile(scope);
    const channels = (profile?.channels?.split(",").filter(Boolean) ?? []).slice(0, 7);
    const targets = channels.length >= 2 ? channels : ["instagram", "facebook", "linkedin"];
    const posts = await refractDraft(
      { title: action.title, body: `${action.title}. ${action.angle}` },
      targets,
      actor,
      scope
    );
    message = `${posts.length} native drafts created — they're in your calendar and Review.`;
  } else if (action.kind === "plan_stubs") {
    const made = await planWeek(scope, { count: 3, horizonDays: 4 });
    message = `${made} posts planned — copy writes itself before each slot.`;
  } else if (action.kind === "ad_variant") {
    await db.adIdea.create({
      data: {
        userId: scope,
        rank: 1,
        title: action.title,
        hook: action.angle.slice(0, 300),
        format: "video",
        targetAudience: "From this week's Pulse",
        brandAngle: action.why,
        status: "shortlisted",
      },
    });
    message = "Shortlisted in Ad Maker — open it to generate the creative (spend still needs your approval).";
  } else {
    throw new Error(`Unknown action kind "${action.kind}".`);
  }

  action.done = true;
  await db.agentReport.update({ where: { id: reportId }, data: { data: JSON.stringify(data) } });
  return message;
}
