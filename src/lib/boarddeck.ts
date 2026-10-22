// Board deck: the supervisor turns the live KPI spread into a board-level
// presentation — structured slides rendered at /reports/deck/<id> in 16:9
// with print CSS, so "Save as PDF" produces the deck. Data in, narrative out;
// every number the agent uses comes from the payload we hand it.

import type { AgentReport } from "@prisma/client";
import { runAgent } from "@/lib/agents/run-agent";
import { dashboardKpis } from "@/lib/reports";
import { spendVsRevenue } from "@/lib/deals";

const DECK_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Deck title, e.g. 'Marketing performance — June 2026'." },
    period: { type: "string", description: "The period covered, human-readable." },
    slides: {
      type: "array",
      description: "8-12 slides, board-level: lead with the story, support with the numbers.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          kicker: { type: "string", description: "Small eyebrow label above the title, or empty string." },
          layout: { type: "string", description: "kpis | bullets | table | statement" },
          kpis: {
            type: "array",
            description: "For layout 'kpis': 3-6 headline numbers.",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string", description: "Formatted, e.g. '£12.4k' or '3.1×'." },
                note: { type: "string", description: "One-line context, or empty string." },
              },
              required: ["label", "value", "note"],
              additionalProperties: false,
            },
          },
          bullets: { type: "array", description: "For layout 'bullets': 3-6 crisp points.", items: { type: "string" } },
          table: {
            type: "object",
            description: "For layout 'table': header row + data rows.",
            properties: {
              headers: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array", items: { type: "string" } } },
            },
            required: ["headers", "rows"],
            additionalProperties: false,
          },
          statement: { type: "string", description: "For layout 'statement': one big takeaway sentence." },
          footnote: { type: "string", description: "Honest caveat for this slide, or empty string." },
        },
        required: ["title", "kicker", "layout", "kpis", "bullets", "table", "statement", "footnote"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "period", "slides"],
  additionalProperties: false,
};

export interface DeckSlide {
  title: string;
  kicker: string;
  layout: string;
  kpis: { label: string; value: string; note: string }[];
  bullets: string[];
  table: { headers: string[]; rows: string[][] };
  statement: string;
  footnote: string;
}
export interface BoardDeck {
  title: string;
  period: string;
  slides: DeckSlide[];
}

export async function buildBoardDeck(scope: string): Promise<AgentReport> {
  const [kpis, svr] = await Promise.all([dashboardKpis(scope), spendVsRevenue(6, scope)]);

  const task = [
    "Build a BOARD-LEVEL marketing performance deck from the measured data below. Audience: owners/directors —",
    "lead each slide with what it MEANS, support with numbers. Recommended slide arc: title/summary → headline",
    "KPIs → spend vs banked revenue (table from the monthly data) → paid performance per network → leads &",
    "pipeline → organic/search (GSC if present) → SEO/GEO state → publishing activity → risks/caveats →",
    "recommendations. Use ONLY the numbers provided; when a section has no data, either skip it or say",
    "'not yet measured' honestly. Currency is GBP. Platform-reported conversion value must be labelled",
    "'platform-reported', never presented as banked revenue — banked revenue is the deals ledger.",
    "",
    "## Live KPI spread (trailing 30 days unless stated)",
    "```json",
    JSON.stringify(kpis, null, 2),
    "```",
    "",
    "## Monthly spend vs banked revenue (last 6 months)",
    "```json",
    JSON.stringify(svr, null, 2),
    "```",
  ].join("\n");

  const { report } = await runAgent<BoardDeck>("marketing-supervisor", task, {
    schema: DECK_SCHEMA,
    maxTokens: 24000,
    reportKind: scope ? `board_deck:${scope}` : "board_deck",
    reportTitle: "Board report",
    scopeUserId: scope,
  });
  return report;
}
