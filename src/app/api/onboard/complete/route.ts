// First Light screens 2-4: confirm the Brand Prism (with any corrections), the
// quiz answers, the creative licence, the planned channels, and which site
// photos to keep. Works for the workspace ("" scope — the owner's business)
// and for member accounts alike.

import { upsertBrandProfile, type BrandProfileInput } from "@/lib/brand-profile";
import { importBrandImages } from "@/lib/onboard";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { track } from "@/lib/events";

export const maxDuration = 120;

interface CompleteBody extends Partial<Omit<BrandProfileInput, "channels" | "palette" | "socialLinks">> {
  channels?: string[];
  imageUrls?: string[];
  colours?: string[];
  socialLinks?: Record<string, string>;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  const body = (await request.json().catch(() => ({}))) as CompleteBody;
  try {
    await upsertBrandProfile(scope, {
      businessName: body.businessName ?? "",
      whatYouSell: body.whatYouSell ?? "",
      audience: body.audience ?? "",
      voice: body.voice,
      region: body.region,
      goals: body.goals,
      creativeLicence: body.creativeLicence,
      channels: (body.channels ?? []).join(","),
      siteUrl: body.siteUrl,
      locations: body.locations,
      serviceAreas: body.serviceAreas,
      phone: body.phone,
      email: body.email,
      address: body.address,
      products: body.products,
      priceBand: body.priceBand,
      offers: body.offers,
      usps: body.usps,
      competitors: body.competitors,
      keywords: body.keywords,
      hashtags: body.hashtags,
      seasonality: body.seasonality,
      fonts: body.fonts,
      palette: Array.isArray(body.colours) ? JSON.stringify(body.colours.slice(0, 8)) : undefined,
      socialLinks: body.socialLinks && typeof body.socialLinks === "object" ? JSON.stringify(body.socialLinks) : undefined,
    });
    const imported = await importBrandImages(body.imageUrls ?? [], scope);
    track("onboarding_screen", scope, { screen: 4 });
    return Response.json({ ok: true, imported });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
