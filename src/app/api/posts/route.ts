import { createDraft, listPosts, type PostInput } from "@/lib/posts";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  return Response.json({ posts: await listPosts(user) });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const input = (await request.json().catch(() => null)) as PostInput | null;
  if (!input) return Response.json({ error: "Missing request body." }, { status: 400 });
  try {
    return Response.json({ post: await createDraft(input, user) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
