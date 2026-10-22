// Mark a lead as SOLD: logs the won deal (amount + date) into the ROAS ledger
// with the source mapped from where the lead came from, and stamps the lead.
// This is what makes ROAS automatic — revenue ties back to the channel that
// produced the lead.

import { db } from "@/lib/db";
import { createDeal } from "@/lib/deals";
import { canTouch, getSessionUser, scopeOf } from "@/lib/auth";
import { journal } from "@/lib/memory";

// Lead source → deal source (deal sources are the ROAS ledger's dimensions).
function dealSource(leadSource: string): string {
  if (leadSource === "meta" || leadSource === "google" || leadSource === "referral") return leadSource;
  return "organic"; // manual / site / webhook / import — not paid-channel revenue
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead || !canTouch(lead, user)) return Response.json({ error: "Lead not found." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { amount?: number; wonAt?: string; notes?: string } | null;
  if (!body || !Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) {
    return Response.json({ error: "Enter the sold value (a positive amount in GBP)." }, { status: 400 });
  }

  try {
    const deal = await createDeal(
      {
        amount: Number(body.amount),
        wonAt: body.wonAt,
        source: dealSource(lead.source),
        name: lead.company ? `${lead.name} · ${lead.company}` : lead.name,
        notes: body.notes,
        createdVia: "manual",
      },
      scopeOf(user)
    );

    const soldLine = `Sold £${Number(body.amount).toLocaleString("en-GB")} on ${new Date(deal.wonAt).toLocaleDateString("en-GB")}.`;
    const updated = await db.lead.update({
      where: { id },
      data: {
        status: "booked",
        lastTouch: new Date(),
        detail: lead.detail ? `${lead.detail}\n\n${soldLine}` : soldLine,
      },
    });

    // Real revenue is the strongest signal the workspace agents get — but only
    // the business's own book; beta sandboxes stay out of the dream memory.
    if (lead.userId === "") {
      journal("marketing-supervisor", {
        kind: "outcome",
        item: "lead sold",
        title: `${lead.name} (${lead.source}) · £${Number(body.amount).toLocaleString("en-GB")}`,
        status: "won",
      });
    }
    return Response.json({ lead: updated, deal: { id: deal.id, amount: deal.amount, source: deal.source } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
