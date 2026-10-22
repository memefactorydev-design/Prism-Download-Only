// Plan a week of post stubs — the copy generates ~2 days before each slot
// (rolling drip), and everything still passes the approval gate.

import { planWeek } from "@/lib/drip";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300;

export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    const created = await planWeek(scopeOf(user));
    return Response.json({ created });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
