// Compose an original music bed with Eleven Music → MediaAsset.

import { getSessionUser, scopeOf } from "@/lib/auth";
import { composeMusicAsset } from "@/lib/music";

export const maxDuration = 300; // composition takes ~30-90s

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { prompt?: string; seconds?: number };
  const prompt = body.prompt?.trim();
  if (!prompt) return Response.json({ error: "Describe the vibe you want composed." }, { status: 400 });
  const seconds = Math.max(10, Math.min(300, Number(body.seconds) || 30));
  try {
    const saved = await composeMusicAsset(prompt, seconds * 1000, scopeOf(user));
    return Response.json(saved);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
