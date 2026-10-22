// Won-deals ledger: manual entry from the /ads page + listing.
// Per-user: the admin works the business ledger (""), members their own sandbox.

import { createDeal, listRecentDeals } from "@/lib/deals";
import { journal } from "@/lib/memory";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = user.role === "admin" ? "" : user.id;
  return Response.json({ deals: await listRecentDeals(50, scope) });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = user.role === "admin" ? "" : user.id;
  const body = (await request.json().catch(() => null)) as {
    amount?: number;
    wonAt?: string;
    source?: string;
    name?: string;
    notes?: string;
  } | null;
  if (!body) return Response.json({ error: "Missing body." }, { status: 400 });
  try {
    const deal = await createDeal({ ...body, amount: Number(body.amount), createdVia: "manual" }, scope);
    // Real revenue is the strongest possible signal for the ads manager's dreams —
    // but only the business's own deals; beta sandboxes stay out of its memory.
    if (scope === "") {
      journal("meta-ads-manager", {
        kind: "outcome",
        item: "won deal",
        title: `${deal.source} · £${deal.amount.toLocaleString("en-GB")}${deal.name ? ` · ${deal.name}` : ""}`,
        status: "won",
      });
    }
    return Response.json({ deal });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
