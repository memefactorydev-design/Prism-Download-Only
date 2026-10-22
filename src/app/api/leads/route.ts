// Leads: list + create. Members see their own book; the admin sees everything.

import { createLead, type LeadInput } from "@/lib/leads";
import { getSessionUser, scopeOf, scopeWhere } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const leads = await db.lead.findMany({ where: scopeWhere(user), orderBy: { createdAt: "desc" }, take: 500 });
  return Response.json({ leads });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const input = (await request.json().catch(() => null)) as LeadInput | null;
  if (!input) return Response.json({ error: "Missing request body." }, { status: 400 });
  try {
    return Response.json({ lead: await createLead(input, scopeOf(user)) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
