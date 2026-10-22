// CRM/n8n → Prism: push a won deal. Protected by DEALS_WEBHOOK_SECRET
// (header "x-webhook-secret") — fails loudly when unset or wrong.
//
// Body: { amount: number (GBP), wonAt?: ISO date, source?: "meta"|"organic"|
//         "referral"|"other", name?: string, notes?: string }

import { createDeal } from "@/lib/deals";
import { journal } from "@/lib/memory";

export async function POST(request: Request) {
  const secret = process.env.DEALS_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "DEALS_WEBHOOK_SECRET isn't set — configure it in .env first." }, { status: 503 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return Response.json({ error: "Invalid webhook secret." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    amount?: number;
    wonAt?: string;
    source?: string;
    name?: string;
    notes?: string;
  } | null;
  if (!body) return Response.json({ error: "Missing JSON body." }, { status: 400 });
  try {
    const deal = await createDeal({ ...body, amount: Number(body.amount), createdVia: "webhook" });
    journal("meta-ads-manager", {
      kind: "outcome",
      item: "won deal (webhook)",
      title: `${deal.source} · £${deal.amount.toLocaleString("en-GB")}${deal.name ? ` · ${deal.name}` : ""}`,
      status: "won",
    });
    return Response.json({ ok: true, id: deal.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
