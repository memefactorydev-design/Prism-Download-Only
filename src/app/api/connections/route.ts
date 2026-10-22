import { getConnectionStatuses, PER_USER_PROVIDERS } from "@/lib/connections";
import { getSessionUser } from "@/lib/auth";

// Status only — secrets are never returned by any endpoint.
// Admins see the workspace stack; members see only THEIR per-user providers
// (Postiz + Meta) — each beta tester connects their own accounts.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const statuses = await getConnectionStatuses(user.id, user.role);
  const visible = user.role === "admin" ? statuses : statuses.filter((s) => PER_USER_PROVIDERS.has(s.provider));
  return Response.json({ connections: visible });
}
