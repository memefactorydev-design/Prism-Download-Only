import { decideAdApproval } from "@/lib/ads";
import { getSessionUser } from "@/lib/auth";

// The spend gate: approving here is the ONLY path to a campaign write, and
// execution still checks App Review status live before touching anything.
// WHO decides is scope-based (enforced in decideAdApproval): the admin for the
// business ad account, each member for recommendations against their own.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  if (body?.decision !== "approve" && body?.decision !== "reject") {
    return Response.json({ error: 'Body must be { "decision": "approve" | "reject" }.' }, { status: 400 });
  }
  try {
    return Response.json({ approval: await decideAdApproval(id, body.decision, user) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
