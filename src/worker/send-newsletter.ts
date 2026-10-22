// Newsletter sender — runs in the worker (bulk email is minutes of I/O that
// would blow a request timeout). Picks up APPROVED newsletters, sends via the
// owning scope's SMTP connection with gentle pacing, and records honest
// per-recipient failure counts. A missing SMTP connection fails the send
// loudly — never a pretended success.

import type { Newsletter } from "@prisma/client";
import { db } from "@/lib/db";
import { getSecrets } from "@/lib/connections";
import { audienceWhere, renderEmailHtml } from "@/lib/newsletter";
import { meterUsage } from "../lib/events";

const PACE_MS = 250; // ~4 emails/sec — polite to any SMTP provider
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function processNewsletter(n: Newsletter): Promise<void> {
  await db.newsletter.update({ where: { id: n.id }, data: { status: "sending", errorMessage: null } });

  try {
    const smtp = await getSecrets("smtp", n.userId);
    if (!smtp) {
      throw new Error("SMTP is not connected for this workspace — add it on the Connections page.");
    }
    const nodemailer = (await import("nodemailer")).default;
    const port = Number(smtp.port) || 587;
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port,
      secure: smtp.secure ?? port === 465,
      auth: { user: smtp.user, pass: smtp.password },
    });

    const recipients = await db.lead.findMany({
      where: audienceWhere(n.userId, n.audience),
      select: { id: true, email: true, name: true },
    });
    if (recipients.length === 0) throw new Error("The audience is empty — nobody subscribed matches this filter.");

    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      if (!r.email) continue;
      try {
        await transport.sendMail({
          from: smtp.fromName ? `"${smtp.fromName}" <${smtp.fromEmail}>` : smtp.fromEmail,
          to: r.email,
          subject: n.subject,
          html: renderEmailHtml(n.bodyHtml, r.id, smtp.fromName),
        });
        sent++;
      } catch (err) {
        failed++;
        console.error(`[newsletter] ${n.id} → ${r.email} failed:`, err instanceof Error ? err.message : err);
      }
      // live progress for the dashboard poll
      if ((sent + failed) % 10 === 0) {
        await db.newsletter.update({ where: { id: n.id }, data: { sentCount: sent, failedCount: failed } });
        meterUsage(n.userId, "email", 1);
      }
      await sleep(PACE_MS);
    }

    await db.newsletter.update({
      where: { id: n.id },
      data: {
        status: failed > 0 && sent === 0 ? "failed" : "sent",
        sentCount: sent,
        failedCount: failed,
        sentAt: new Date(),
        errorMessage: failed > 0 && sent === 0 ? "Every send failed — check the SMTP connection." : null,
      },
    });
  } catch (err) {
    await db.newsletter.update({
      where: { id: n.id },
      data: { status: "failed", errorMessage: err instanceof Error ? err.message : String(err) },
    });
  }
}

/** Called from the worker poll loop: drain approved newsletters one at a time. */
export async function maybeSendNewsletters(): Promise<void> {
  const next = await db.newsletter.findFirst({ where: { status: "approved" }, orderBy: { updatedAt: "asc" } });
  if (!next) return;
  console.log(`[newsletter] sending ${next.id} ("${next.subject}")`);
  await processNewsletter(next);
  const after = await db.newsletter.findUnique({ where: { id: next.id } });
  console.log(`[newsletter] ${next.id} → ${after?.status} (${after?.sentCount} sent, ${after?.failedCount} failed)`);
}
