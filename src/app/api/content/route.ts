import { generateContent } from "@/lib/content";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    kind?: string;
    topic?: string;
    keyword?: string;
    notes?: string;
  };
  const kind = body.kind === "faq" ? "faq" : "blog";
  if (!body.topic?.trim()) return Response.json({ error: "Enter a topic." }, { status: 400 });
  try {
    const draft = await generateContent({ kind, topic: body.topic, keyword: body.keyword, notes: body.notes }, scopeOf(user));
    return Response.json({ id: draft.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
