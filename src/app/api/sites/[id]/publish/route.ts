// Publish a built site to a target. in_app is a direct owner action; wordpress
// and ftp push to a production host (the UI confirms first) and are logged.
// Members may publish in-app (their /s/<slug> page) — WordPress/FTP use the
// WORKSPACE's hosting credentials, so those targets stay admin-only.

import { db } from "@/lib/db";
import { publishSiteInApp, publishSiteWordpress, publishSiteFtp } from "@/lib/publish";
import { canTouch, getSessionUser } from "@/lib/auth";

export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await db.site.findUnique({ where: { id } });
  if (!site || !canTouch(site, user)) return Response.json({ error: "Site not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { target?: string };
  try {
    let result;
    switch (body.target) {
      case "in_app":
        result = await publishSiteInApp(id);
        break;
      case "wordpress":
      case "ftp":
        if (user.role !== "admin") {
          return Response.json(
            { error: "WordPress/FTP publishing uses the workspace's hosting credentials — publish in-app or export instead." },
            { status: 403 }
          );
        }
        result = body.target === "wordpress" ? await publishSiteWordpress(id) : await publishSiteFtp(id);
        break;
      default:
        return Response.json({ error: "Pick a publish target (in_app, wordpress or ftp)." }, { status: 400 });
    }
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
