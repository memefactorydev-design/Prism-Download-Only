// The brand profile for the caller's scope — the workspace's for admins, their
// own for members. What every agent researches and writes for.

import { getBrandProfile, upsertBrandProfile, type BrandProfileInput } from "@/lib/brand-profile";
import { getSessionUser, scopeOf } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  const profile = await getBrandProfile(scope);
  return Response.json({ profile, workspace: scope === "" });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as BrandProfileInput | null;
  if (!body) return Response.json({ error: "Missing request body." }, { status: 400 });
  try {
    const profile = await upsertBrandProfile(scopeOf(user), body);
    return Response.json({ profile });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
