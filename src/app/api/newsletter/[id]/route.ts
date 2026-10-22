// One newsletter: edit the draft, { action: "send" } to queue it (the send
// decision — you're emailing real people — is the scope owner's, like posts),
// or delete a draft.

import { db } from "@/lib/db";
import { audienceCount, validAudience } from "@/lib/newsletter";
import { canTouch, getSessionUser } from "@/lib/auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const existing = await db.newsletter.findUnique({ where: { id } });
  if (!existing || !canTouch(existing, user)) return Response.json({ error: "Newsletter not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as
    | { action?: "send"; subject?: string; bodyHtml?: string; audience?: string }
    | null;
  if (!body) return Response.json({ error: "Missing request body." }, { status: 400 });

  try {
    if (body.action === "send") {
      if (!["draft", "failed"].includes(existing.status)) {
        return Response.json({ error: `This newsletter is ${existing.status} — only drafts can be sent.` }, { status: 409 });
      }
      const recipients = await audienceCount(existing.userId, existing.audience);
      if (recipients === 0) {
        return Response.json({ error: "The audience is empty — nobody subscribed matches this filter." }, { status: 422 });
      }
      // "approved" hands it to the worker, which sends via the scope's SMTP.
      const newsletter = await db.newsletter.update({
        where: { id },
        data: { status: "approved", errorMessage: null },
      });
      return Response.json({ newsletter, recipients });
    }

    if (existing.status !== "draft" && existing.status !== "failed") {
      return Response.json({ error: `A ${existing.status} newsletter can no longer be edited.` }, { status: 409 });
    }
    const newsletter = await db.newsletter.update({
      where: { id },
      data: {
        subject: body.subject?.trim() ? body.subject.trim().slice(0, 200) : undefined,
        bodyHtml: body.bodyHtml?.trim() ? body.bodyHtml : undefined,
        audience: body.audience !== undefined ? validAudience(body.audience) : undefined,
        status: "draft",
      },
    });
    return Response.json({ newsletter });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const existing = await db.newsletter.findUnique({ where: { id } });
  if (existing && canTouch(existing, user) && ["draft", "failed", "sent"].includes(existing.status)) {
    await db.newsletter.delete({ where: { id } });
  }
  return Response.json({ ok: true });
}
