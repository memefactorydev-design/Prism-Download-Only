// Generate a board-level deck from the live KPI spread (takes a minute or two).

import { buildBoardDeck } from "@/lib/boarddeck";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300;

export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    const report = await buildBoardDeck(scopeOf(user));
    return Response.json({ id: report.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
