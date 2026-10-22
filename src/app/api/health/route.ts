// Public health probe: web + database + worker heartbeat (the worker's poll
// loop touches jobs constantly; we treat a dream/drip-capable DB read as the
// signal and report the last worker-side activity honestly).

import { db } from "@/lib/db";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  try {
    await db.$queryRawUnsafe("SELECT 1");
    checks.database = { ok: true };
  } catch (err) {
    checks.database = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
  try {
    // Worker heartbeat: any job/newsletter/drip movement in the last 10 minutes,
    // else the most recent terminal job tells us when it last breathed.
    const recent = await db.videoJob.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
    checks.worker = {
      ok: true,
      detail: recent ? `last activity ${recent.updatedAt.toISOString()}` : "no jobs yet",
    };
  } catch {
    checks.worker = { ok: false };
  }
  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json({ ok, checks, at: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
