// Public one-click unsubscribe (linked from every newsletter email). The
// signature pins the link to one lead — no session, no guessable action.

import { db } from "@/lib/db";
import { verifyUnsubscribeSig } from "@/lib/newsletter";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lead = url.searchParams.get("lead") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  if (!lead || !verifyUnsubscribeSig(lead, sig)) {
    return new Response("This unsubscribe link isn't valid.", { status: 400 });
  }
  await db.lead.updateMany({ where: { id: lead }, data: { subscribed: false } });
  return new Response(
    `<!doctype html><html><body style="font-family:-apple-system,sans-serif;padding:60px 24px;text-align:center;color:#1a1a22;">
     <h1 style="font-size:22px;">You're unsubscribed.</h1>
     <p style="color:#6a6a74;">You won't receive further newsletters from us.</p></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
