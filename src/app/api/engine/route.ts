// The AI engine: which one is active, what is installed/signed in, and (admin)
// which one to use. Engines bill the signed-in user's own plan or key; this
// route never sees or returns a credential.

import { requireAdmin, requireUser } from "@/lib/auth";
import { engineModeLockedByEnv, engineOverview, forgetEngineCache, isEngineMode, lastClaudeRateLimit, setEngineMode } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireUser();
  if (denied) return denied;
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (force) forgetEngineCache();
  const overview = await engineOverview(force);
  return Response.json({ ...overview, lockedByEnv: engineModeLockedByEnv(), claudeRateLimit: lastClaudeRateLimit() });
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (engineModeLockedByEnv()) {
    return Response.json({ error: "LLM_ENGINE is set in .env — change it there." }, { status: 409 });
  }
  const body = (await request.json().catch(() => ({}))) as { mode?: string };
  const mode = (body.mode ?? "").trim();
  if (!isEngineMode(mode)) return Response.json({ error: "Unknown engine." }, { status: 400 });
  await setEngineMode(mode);
  const overview = await engineOverview(true);
  return Response.json(overview);
}
