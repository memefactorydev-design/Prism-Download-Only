// The newsletter designer: prompt in, complete email HTML out. Iterative —
// pass currentHtml to amend the existing design instead of starting over.

import { generateEmail } from "@/lib/builder";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { instruction?: string; currentHtml?: string } | null;
  if (!body?.instruction?.trim()) {
    return Response.json({ error: "Describe what the email should look like." }, { status: 400 });
  }
  try {
    const html = await generateEmail({
      instruction: body.instruction.trim(),
      currentHtml: body.currentHtml ?? "",
      scopeUserId: scopeOf(user),
    });
    return Response.json({ html });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
