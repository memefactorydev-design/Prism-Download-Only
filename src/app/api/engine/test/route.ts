// "Run a test": one tiny generation on the active engine so the owner can see
// it answer, which model replied, and that it billed their plan — not credits.

import { requireAdmin } from "@/lib/auth";
import { isEngineNotReady, isUsageLimit, testEngine } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const result = await testEngine();
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = isEngineNotReady(err) ? 409 : isUsageLimit(err) ? 429 : 502;
    return Response.json({ error: message }, { status });
  }
}
