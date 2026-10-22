// First Light screen 1→2: one URL in, a Brand Prism draft out (plus the facts
// we read deterministically — contact details, social links, colours, type).

import { scrapeBusinessSite, inferBrand } from "@/lib/onboard";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { track } from "@/lib/events";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { source?: string };
  if (!body.source?.trim()) return Response.json({ error: "Tell us where your business lives — a website address." }, { status: 400 });
  const scope = scopeOf(user);
  track("onboarding_screen", scope, { screen: 1 });
  try {
    const site = await scrapeBusinessSite(body.source);
    const brand = await inferBrand(site, scope);
    return Response.json({
      brand,
      site: {
        url: site.url,
        colours: site.colours,
        fonts: site.fonts,
        images: site.images,
        phone: site.phone,
        email: site.email,
        address: site.address,
        socialLinks: site.socialLinks,
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
