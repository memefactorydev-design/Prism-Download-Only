// Newsletter core: compose → approve → the WORKER sends via the scope's own
// SMTP connection. Audience = subscribed leads in the same scope (optionally
// filtered to one kanban status). Every email carries a signed unsubscribe
// link that flips the lead's opt-in — basic, honest email hygiene.

import { createHmac } from "node:crypto";
import type { Newsletter } from "@prisma/client";
import { db } from "@/lib/db";
import { LEAD_STATUSES } from "@/lib/leads";

export interface NewsletterInput {
  subject: string;
  bodyHtml: string;
  audience?: string; // "subscribed" | "status:<status>"
}

export function validAudience(a?: string): string {
  if (!a || a === "subscribed") return "subscribed";
  const m = a.match(/^status:(\w+)$/);
  if (m && (LEAD_STATUSES as readonly string[]).includes(m[1])) return a;
  throw new Error(`Audience must be "subscribed" or "status:<${LEAD_STATUSES.join("|")}>".`);
}

export function audienceWhere(scopeUserId: string, audience: string) {
  const base = { userId: scopeUserId, subscribed: true, email: { not: null } };
  const m = audience.match(/^status:(\w+)$/);
  return m ? { ...base, status: m[1] } : base;
}

export async function audienceCount(scopeUserId: string, audience: string): Promise<number> {
  return db.lead.count({ where: audienceWhere(scopeUserId, audience) });
}

export async function createNewsletter(input: NewsletterInput, scopeUserId = ""): Promise<Newsletter> {
  if (!input.subject?.trim()) throw new Error("The newsletter needs a subject.");
  if (!input.bodyHtml?.trim()) throw new Error("The newsletter needs a body.");
  return db.newsletter.create({
    data: {
      userId: scopeUserId,
      subject: input.subject.trim().slice(0, 200),
      bodyHtml: input.bodyHtml,
      audience: validAudience(input.audience),
    },
  });
}

// ── Unsubscribe links: HMAC-signed with the app's existing secret ────────────

function unsubSecret(): string {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is not set.");
  return key;
}

export function unsubscribeSig(leadId: string): string {
  return createHmac("sha256", unsubSecret()).update(`unsub:${leadId}`).digest("hex").slice(0, 32);
}

export function verifyUnsubscribeSig(leadId: string, sig: string): boolean {
  return Boolean(sig) && unsubscribeSig(leadId) === sig;
}

export function unsubscribeUrl(leadId: string): string {
  const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/newsletter/unsubscribe?lead=${leadId}&sig=${unsubscribeSig(leadId)}`;
}

/** Wrap the composed body in a minimal, mail-client-safe shell + unsubscribe. */
export function renderEmailHtml(bodyHtml: string, leadId: string, fromName?: string | null): string {
  return [
    `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f6;">`,
    `<div style="max-width:640px;margin:0 auto;padding:32px 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a22;">`,
    `<div style="background:#ffffff;border-radius:12px;padding:32px;">${bodyHtml}</div>`,
    `<p style="font-size:12px;color:#8a8a94;text-align:center;margin-top:20px;">`,
    fromName ? `Sent by ${fromName}. ` : "",
    `<a href="${unsubscribeUrl(leadId)}" style="color:#8a8a94;">Unsubscribe</a></p>`,
    `</div></body></html>`,
  ].join("");
}
