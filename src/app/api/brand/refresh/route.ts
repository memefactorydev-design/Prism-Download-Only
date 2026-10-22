// "Update from my website": re-runs the site→brand inference result into the
// profile WITHOUT touching creativeLicence/channels or the quiz answers
// (upsertBrandProfile leaves omitted keys unchanged) — and therefore without
// touching scheduling, posts or connections. Image import is additive,
// best-effort. Works for the workspace scope and for members.

import { upsertBrandProfile } from "@/lib/brand-profile";
import { importBrandImages } from "@/lib/onboard";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { track } from "@/lib/events";

export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  const body = (await request.json().catch(() => ({}))) as {
    businessName?: string;
    whatYouSell?: string;
    audience?: string;
    voice?: string;
    region?: string;
    goals?: string;
    siteUrl?: string;
    imageUrls?: string[];
  };
  try {
    await upsertBrandProfile(scope, {
      businessName: body.businessName ?? "",
      whatYouSell: body.whatYouSell ?? "",
      audience: body.audience ?? "",
      voice: body.voice,
      region: body.region,
      goals: body.goals,
      siteUrl: body.siteUrl,
      // creativeLicence, channels and the quiz fields deliberately absent — left unchanged.
    });
    const imported = await importBrandImages(body.imageUrls ?? [], scope);
    track("brand_refreshed", scope, { url: body.siteUrl ?? "" });
    return Response.json({ ok: true, imported });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
