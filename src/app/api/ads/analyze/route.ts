import { runAdsAnalysis, type AdNetwork } from "@/lib/ads";
import { getSessionUser } from "@/lib/auth";

// Sync insights from the ad network's API, run its ads-manager agent, queue
// approvals. Body: { network?: "meta" | "google" } (meta default).
// Per-user: the admin analyses the business accounts, a member their own.
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = user.role === "admin" ? "" : user.id;
  const body = (await request.json().catch(() => ({}))) as { network?: string; challenger?: boolean; capPct?: number };
  const network: AdNetwork = body.network === "google" ? "google" : "meta";
  try {
    return Response.json({ summary: await runAdsAnalysis(scope, network, { challenger: body.challenger, capPct: body.capPct }) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
