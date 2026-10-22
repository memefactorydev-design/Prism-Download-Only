// Newsletters: list + create. { draftWithAi: true } asks content-writer-agent
// to write the issue from a topic before saving.

import { createNewsletter, audienceCount, validAudience, type NewsletterInput } from "@/lib/newsletter";
import { runAgent } from "@/lib/agents/run-agent";
import { getSessionUser, scopeOf, scopeWhere } from "@/lib/auth";
import { db } from "@/lib/db";

export const maxDuration = 180;

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "An open-worthy subject line, under 65 characters, no clickbait." },
    bodyHtml: {
      type: "string",
      description:
        "The newsletter body as clean semantic HTML (h2/p/ul/a, inline styles only where needed). Warm, useful, on-brand. No <html>/<body> wrapper.",
    },
  },
  required: ["subject", "bodyHtml"],
  additionalProperties: false,
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const newsletters = await db.newsletter.findMany({
    where: scopeWhere(user),
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Response.json({ newsletters });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  const body = (await request.json().catch(() => null)) as
    | (Partial<NewsletterInput> & { draftWithAi?: boolean; topic?: string })
    | null;
  if (!body) return Response.json({ error: "Missing request body." }, { status: 400 });

  try {
    let subject = body.subject ?? "";
    let bodyHtml = body.bodyHtml ?? "";
    if (body.draftWithAi) {
      if (!body.topic?.trim()) return Response.json({ error: "Give the AI a topic to write about." }, { status: 400 });
      const { data } = await runAgent<{ subject: string; bodyHtml: string }>("content-writer-agent", [
        `Write a newsletter issue about: "${body.topic.trim()}".`,
        "It goes to the brand's subscribed leads — people who already enquired. Useful and warm beats salesy;",
        "one clear call to action near the end. Return the structured object.",
      ].join("\n"), {
        schema: DRAFT_SCHEMA,
        maxTokens: 8000,
        reportKind: "newsletter_draft",
        reportTitle: `Newsletter: ${body.topic.trim().slice(0, 60)}`,
        scopeUserId: scope,
      });
      if (!data) throw new Error("content-writer-agent returned nothing.");
      subject = data.subject;
      bodyHtml = data.bodyHtml;
    }
    const newsletter = await createNewsletter({ subject, bodyHtml, audience: body.audience }, scope);
    const recipients = await audienceCount(scope, validAudience(body.audience));
    return Response.json({ newsletter, recipients });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
