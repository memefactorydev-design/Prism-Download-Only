// Site forms / n8n / Zapier → Prism leads. Protected by LEADS_WEBHOOK_SECRET
// (header "x-webhook-secret") — fails loudly when unset or wrong.
//
// Body: { name: string, email?: string, phone?: string, company?: string,
//         detail?: string, source?: string ("site" default) }
// Leads land in the WORKSPACE book ("") — per-user capture can come later via
// per-user secrets if beta users need their own forms.

import { createLead } from "@/lib/leads";

export async function POST(request: Request) {
  const secret = process.env.LEADS_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "LEADS_WEBHOOK_SECRET isn't set — configure it in .env first." }, { status: 503 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return Response.json({ error: "Invalid webhook secret." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    detail?: string;
    source?: string;
  } | null;
  if (!body?.name) return Response.json({ error: "name is required." }, { status: 400 });
  try {
    const lead = await createLead({ ...body, name: body.name, source: body.source ?? "site" }, "");
    return Response.json({ ok: true, id: lead.id, score: lead.score });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
