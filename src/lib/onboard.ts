// First Light onboarding: one question in — "where does your business live?" —
// a Brand Prism out. We read the site ourselves (title, copy, colours, fonts,
// imagery, contact details, social links), have the supervisor distil it into a
// brand profile the user only has to CORRECT, ask a short quiz for what a
// website rarely says (areas served, price band, offers, competitors), and
// import their real photos into the media library. Honest by construction:
// what we couldn't read, we say.

import { db } from "@/lib/db";
import { runAgent } from "@/lib/agents/run-agent";
import { getStorage } from "@/lib/storage";
import { track } from "@/lib/events";
import { extractContacts, type SiteContacts } from "@/lib/onboard-extract";

export interface ScrapedSite extends SiteContacts {
  url: string;
  title: string;
  description: string;
  textSample: string;
  colours: string[]; // hex, most-used first
  fonts: string[];
  images: string[]; // absolute URLs, best-guess brand imagery
}

export interface InferredBrand {
  businessName: string;
  whatYouSell: string;
  audience: string;
  voice: string;
  region: string;
  goals: string;
  // Quiz prefill — empty string when the site doesn't say.
  products: string;
  priceBand: string;
  offers: string;
  usps: string;
  locations: string;
  serviceAreas: string;
  competitors: string;
  keywords: string;
  hashtags: string;
  seasonality: string;
  confidence: string; // one honest line about what was inferred vs guessed
}

const INFER_SCHEMA = {
  type: "object",
  properties: {
    businessName: { type: "string" },
    whatYouSell: { type: "string", description: "Products/services + what makes them different, 2-3 sentences." },
    audience: { type: "string", description: "Who buys and where, 1-2 sentences." },
    voice: { type: "string", description: "Tone of voice in a short phrase, e.g. 'warm, premium, plain-spoken'." },
    region: { type: "string", description: "Geography served, or empty string." },
    goals: { type: "string", description: "Likely marketing goal, one sentence." },
    products: { type: "string", description: "The main products or services as a short comma list, or empty string." },
    priceBand: { type: "string", description: "Typical price band ONLY if prices appear on the site, else empty string." },
    offers: { type: "string", description: "Current offers or promotions stated on the site, verbatim-ish, else empty string." },
    usps: { type: "string", description: "What the site claims sets the business apart, 2-4 short bullets joined by '; ', else empty string." },
    locations: { type: "string", description: "Physical locations (branches, showrooms, studios, venues) with towns, else empty string." },
    serviceAreas: { type: "string", description: "Towns/regions the business says it serves, comma list, else empty string." },
    competitors: { type: "string", description: "Competitors named on the site, comma list — do not guess any, else empty string." },
    keywords: { type: "string", description: "5-8 search terms a customer would type to find this business, comma list." },
    hashtags: { type: "string", description: "Hashtags the site itself uses, comma list, else empty string." },
    seasonality: { type: "string", description: "Seasonal peaks or moments the site mentions, else empty string." },
    confidence: { type: "string", description: "One honest line: what was read from the site vs guessed." },
  },
  required: [
    "businessName", "whatYouSell", "audience", "voice", "region", "goals",
    "products", "priceBand", "offers", "usps", "locations", "serviceAreas", "competitors", "keywords", "hashtags", "seasonality",
    "confidence",
  ],
  additionalProperties: false,
};

function absolutise(src: string, base: URL): string | null {
  try {
    const u = new URL(src, base);
    return u.protocol.startsWith("http") ? u.href : null;
  } catch {
    return null;
  }
}

export async function scrapeBusinessSite(input: string): Promise<ScrapedSite> {
  let url = input.trim();
  if (url.startsWith("@")) {
    throw new Error(
      "Instagram-only for now needs one more step — pop in your website address instead, or a link-in-bio page works too."
    );
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const base = new URL(url);

  const res = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PrismOnboarding/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`We couldn't open ${base.hostname} (HTTP ${res.status}) — check the address and try again.`);
  const html = (await res.text()).slice(0, 600_000);

  const pick = (re: RegExp) => html.match(re)?.[1]?.trim() ?? "";
  const title = pick(/<title[^>]*>([^<]{1,200})/i);
  const description =
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})/i) ||
    pick(/<meta[^>]+content=["']([^"']{1,400})["'][^>]+name=["']description["']/i);

  // Visible copy sample: strip scripts/styles/tags.
  const textSample = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);

  // Colours: most-frequent hex codes, ignoring near-white/near-black chrome.
  const colourCounts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const hex = m[1].toLowerCase();
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const lum = (r + g + b) / 3;
    if (lum > 245 || lum < 12) continue;
    colourCounts.set(`#${hex}`, (colourCounts.get(`#${hex}`) ?? 0) + 1);
  }
  const colours = [...colourCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);

  // Fonts: named families, minus generic fallbacks.
  const fonts = [
    ...new Set(
      [...html.matchAll(/font-family:\s*['"]?([A-Za-z][A-Za-z0-9 _-]{2,40})/g)]
        .map((m) => m[1].trim())
        .filter((f) => !/^(sans-serif|serif|monospace|inherit|initial|system-ui|Arial|Helvetica)$/i.test(f))
    ),
  ].slice(0, 4);

  // Imagery: og:image first, then page <img>s (skip icons/sprites/svg).
  const images: string[] = [];
  const og = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
  if (og) {
    const abs = absolutise(og, base);
    if (abs) images.push(abs);
  }
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const abs = absolutise(m[1], base);
    if (!abs || /\.svg|sprite|icon|logo-?small|favicon|\.gif/i.test(abs)) continue;
    if (!images.includes(abs)) images.push(abs);
    if (images.length >= 10) break;
  }

  const contacts = extractContacts(html, textSample);
  return { url: base.href, title, description, textSample, colours, fonts, images, ...contacts };
}

export async function inferBrand(site: ScrapedSite, scopeUserId: string): Promise<InferredBrand> {
  const facts = [
    site.phone ? `Phone: ${site.phone}` : "",
    site.email ? `Email: ${site.email}` : "",
    site.address ? `Address: ${site.address}` : "",
    Object.keys(site.socialLinks).length
      ? `Social profiles: ${Object.entries(site.socialLinks).map(([k, v]) => `${k} ${v}`).join(", ")}`
      : "",
  ].filter(Boolean);
  const task = [
    "Distil this business's website into a brand profile. Use ONLY what the site supports; where you must guess, guess conservatively and say so in `confidence`. Never invent specifics (awards, years, prices, offers, competitors) the text doesn't show — leave those fields as empty strings.",
    "",
    `## Site: ${site.url}`,
    `Title: ${site.title || "(none)"}`,
    `Meta description: ${site.description || "(none)"}`,
    facts.length ? ["", "## Facts read directly from the page (trust these)", ...facts].join("\n") : "",
    "",
    "## Page copy (sample)",
    site.textSample || "(the page had no readable text)",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  const { data } = await runAgent<InferredBrand>("marketing-supervisor", task, {
    schema: INFER_SCHEMA,
    maxTokens: 6000,
    reportKind: "brand_inference",
    reportTitle: `Brand Prism: ${site.title || site.url}`,
    scopeUserId,
    // The whole point of this run is to READ THE SITE — any existing profile
    // must not leak in, or a brand refresh just echoes the old brand.
    brandNeutral: true,
  });
  if (!data?.businessName) throw new Error("We couldn't read enough from that page — try your main homepage URL.");
  track("onboarding_inferred", scopeUserId, { url: site.url });
  return data;
}

const IMG_MIMES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

/** Import chosen site images into the scope's media library. Best-effort per image. */
export async function importBrandImages(urls: string[], scopeUserId: string): Promise<number> {
  let imported = 0;
  for (const u of urls.slice(0, 6)) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const mime = res.headers.get("content-type")?.split(";")[0] ?? "";
      const ext = IMG_MIMES[mime];
      if (!ext) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 8_000 || buffer.length > 15_000_000) continue; // skip trackers + monsters
      const stored = await getStorage().save(buffer, ext);
      await db.mediaAsset.create({
        data: {
          userId: scopeUserId,
          originalName: `site-${new URL(u).pathname.split("/").pop()?.slice(0, 60) || "image"}${ext}`,
          mimeType: mime,
          sizeBytes: buffer.length,
          storageDriver: stored.storageDriver,
          storagePath: stored.storagePath,
        },
      });
      imported += 1;
    } catch {
      /* skip — best-effort */
    }
  }
  return imported;
}
