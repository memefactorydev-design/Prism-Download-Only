import { decidePost } from "@/lib/posts";
import { getSessionUser } from "@/lib/auth";

// The explicit approval gate: nothing publishes without a decision through here.
// WHO decides is scope-based (enforced in decidePost): the admin for workspace
// posts, each member for their own sandboxed posts — those publish to the
// member's own Postiz channels, so the decision (and the risk) is theirs.
// "approve" also retries scheduling for an approved post whose Postiz push failed.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  if (body?.decision !== "approve" && body?.decision !== "reject") {
    return Response.json({ error: 'Body must be { "decision": "approve" | "reject" }.' }, { status: 400 });
  }
  try {
    return Response.json({ post: await decidePost(id, body.decision, user) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
