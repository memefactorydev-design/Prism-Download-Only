import { db } from "@/lib/db";
import { publishContentWordpress, publishContentFtp } from "@/lib/publish";
import { journal } from "@/lib/memory";
import { canTouch, getSessionUser } from "@/lib/auth";

export const maxDuration = 120;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const existing = await db.contentDraft.findUnique({ where: { id } });
  if (!existing || !canTouch(existing, user)) return Response.json({ error: "Draft not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { action?: "publish"; target?: string; status?: string };
  try {
    if (body.action === "publish") {
      // WordPress/FTP are the WORKSPACE's connections (they push to the business's
      // site), so external publishing stays admin-only. Members copy/export instead.
      if (user.role !== "admin") {
        return Response.json(
          { error: "Publishing to WordPress/FTP uses the workspace's site credentials — copy or export the draft instead." },
          { status: 403 }
        );
      }
      if (body.target !== "wordpress" && body.target !== "ftp") {
        return Response.json({ error: "Pick a publish target (wordpress or ftp)." }, { status: 400 });
      }
      const result =
        body.target === "wordpress" ? await publishContentWordpress(id) : await publishContentFtp(id);
      // Publishing a draft is the strongest approval signal the writer gets.
      if (existing.userId === "") {
        journal("content-writer-agent", {
          kind: "outcome",
          item: existing.kind,
          title: existing.title,
          status: `published to ${body.target}`,
        });
      }
      return Response.json(result);
    }
    if (body.status) {
      const draft = await db.contentDraft.update({ where: { id }, data: { status: body.status } });
      if (body.status === "archived" && draft.userId === "") {
        journal("content-writer-agent", { kind: "outcome", item: draft.kind, title: draft.title, status: "archived" });
      }
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Nothing to do." }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const existing = await db.contentDraft.findUnique({ where: { id } });
  if (existing && canTouch(existing, user)) {
    await db.contentDraft.delete({ where: { id } });
  }
  return Response.json({ ok: true });
}
