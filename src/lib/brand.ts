// Central brand identity for the app. One place to tune the name/voice.

export const BRAND = "Prism";
export const PRODUCT = "AI";
export const APP_NAME = "Prism AI";
export const TAGLINE = "Trends into content. Content into revenue.";
export const BLURB =
  "One upload, refracted into everything. Prism turns raw footage and live trends into platform-ready content — then posts it, promotes it, and reports back.";
export const VERSION = "v2.0";

// The business this marketing engine works for is NOT a constant: it is the
// BrandProfile captured at /welcome (see src/lib/brand-profile.ts), rendered
// into a brief for every agent. Nothing client-specific lives in code.

// White-label names for the engine stack. Members (and the Overview, which
// everyone sees) get these Prism-branded identities instead of vendor names —
// the real stack stays visible only on the admin Connections page.
export const STACK_ALIASES: Record<string, { label: string; sub: string }> = {
  anthropic: { label: "Prism Mind", sub: "The creative brain behind every agent" },
  gemini: { label: "Prism Lens", sub: "Live-web vision + AI visuals" },
  postiz: { label: "Prism Beam", sub: "One-tap publish to every channel" },
  meta: { label: "Ads Engine", sub: "Paid reach + ROAS tracking" },
  apify: { label: "Prism Radar", sub: "Scans what's going viral right now" },
  elevenlabs: { label: "Prism Voice", sub: "Voice-overs & original scores" },
  pexels: { label: "Stock Vault", sub: "Licensed b-roll & photography" },
  fal: { label: "Prism Motion", sub: "AI video generation" },
  wordpress: { label: "Site Publisher", sub: "Pushes pages to your website" },
  ftp: { label: "Static Publisher", sub: "Uploads sites to any host" },
};
