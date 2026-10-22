// Prism Pulse: generate this week's read (POST) — own data + live trends +
// three one-tap actions, each ending in an approval.

import { buildPulse } from "@/lib/pulse";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300;

export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    const report = await buildPulse(scopeOf(user));
    return Response.json({ id: report.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
