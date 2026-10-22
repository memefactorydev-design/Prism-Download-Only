import { db } from "@/lib/db";
import { journal } from "@/lib/memory";
import { canTouch, getSessionUser } from "@/lib/auth";

const STATUSES = ["new", "shortlisted", "in_production", "used", "archived"];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { status?: string } | null;
  if (!body?.status || !STATUSES.includes(body.status)) {
    return Response.json({ error: `status must be one of: ${STATUSES.join(", ")}` }, { status: 400 });
  }
  const existing = await db.adIdea.findUnique({ where: { id } });
  if (!existing || !canTouch(existing, user)) return Response.json({ error: "Idea not found." }, { status: 404 });
  const idea = await db.adIdea.update({ where: { id }, data: { status: body.status } });
  // Real-world feedback for the researcher's dream cycle — workspace ideas only;
  // beta sandboxes stay out of the brand agents' memory.
  if (idea.userId === "") {
    journal("ad-research-agent", { kind: "outcome", item: "ad idea", title: idea.title, status: body.status });
  }
  return Response.json({ idea });
}
