// Job status for the Studio UI to poll: returns the job, its source asset, and
// the generated clips (with their rendered-asset ids for preview/download).
// Scope-checked: members can only poll their own jobs.

import { getJobView } from "@/lib/studio";
import { getSessionUser } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const view = await getJobView((await params).id, user);
  if (!view) return Response.json({ error: "Job not found." }, { status: 404 });
  return Response.json(view);
}
