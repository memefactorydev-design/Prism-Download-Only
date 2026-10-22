import { deletePost, submitForApproval, updateDraft, type PostInput } from "@/lib/posts";
import { getSessionUser } from "@/lib/auth";

// PATCH edits a draft; { action: "submit" } sends it to the approval queue.
// Ownership is enforced in lib/posts.ts: members touch only their own posts.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | (Partial<PostInput> & { action?: "submit" })
    | null;
  if (!body) return Response.json({ error: "Missing request body." }, { status: 400 });

  try {
    const { action, ...fields } = body;
    let post = Object.keys(fields).length > 0 ? await updateDraft(id, fields, user) : undefined;
    if (action === "submit") post = await submitForApproval(id, user);
    if (!post) return Response.json({ error: "Nothing to do." }, { status: 400 });
    return Response.json({ post });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    await deletePost((await params).id, user);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
