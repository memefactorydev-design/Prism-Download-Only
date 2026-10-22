// Pure extractors for onboarding: contact details and social links read from
// a business's homepage HTML. Deterministic, no network, unit-tested. The
// model only ever gets to CONFIRM what these found — it never invents a phone
// number or an address.

export interface SiteContacts {
  phone: string;
  email: string;
  address: string;
  socialLinks: Record<string, string>;
}

const SOCIAL_HOSTS: Record<string, RegExp> = {
  instagram: /instagram\.com\/[a-z0-9_.]+/i,
  facebook: /facebook\.com\/[a-z0-9_.-]+/i,
  tiktok: /tiktok\.com\/@[a-z0-9_.]+/i,
  youtube: /youtube\.com\/(?:@|channel\/|c\/|user\/)[a-z0-9_.-]+/i,
  linkedin: /linkedin\.com\/(?:company|in)\/[a-z0-9_.-]+/i,
  pinterest: /pinterest\.(?:com|co\.uk)\/[a-z0-9_.-]+/i,
  x: /(?:twitter|x)\.com\/[a-z0-9_]+/i,
  houzz: /houzz\.(?:com|co\.uk)\/(?:pro|professionals)\/[a-z0-9_.-]+/i,
};

const GENERIC_SOCIAL_PATH = /\/(?:sharer|share|intent|plugins|p\/|reel|hashtag|explore|home|login|policies)/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function cleanPhone(raw: string): string {
  const s = decodeEntities(raw).replace(/^tel:/i, "").replace(/[^\d+()\s.-]/g, "").trim();
  const digits = s.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 16 ? s.replace(/\s+/g, " ") : "";
}

function jsonLdField(html: string, key: string): string {
  const m = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]{2,200})"`));
  return m ? decodeEntities(m[1]) : "";
}

/** Phone, email, postal address and social profile links from raw HTML. */
export function extractContacts(html: string, textSample: string): SiteContacts {
  // Phone: tel: links first (unambiguous), then schema.org, then visible text.
  let phone = "";
  const tel = html.match(/href=["']tel:([^"']{6,30})["']/i);
  if (tel) phone = cleanPhone(tel[1]);
  if (!phone) phone = cleanPhone(jsonLdField(html, "telephone"));
  if (!phone) {
    const visible = textSample.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?0\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}\b/);
    if (visible) phone = cleanPhone(visible[0]);
  }

  // Email: mailto first, then schema.org, then the first plausible address in text.
  let email = "";
  const mailto = html.match(/href=["']mailto:([^"'?]{5,120})["'?]/i);
  if (mailto) email = decodeEntities(mailto[1]).toLowerCase();
  if (!email) email = jsonLdField(html, "email").toLowerCase();
  if (!email) {
    const visible = textSample.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i);
    if (visible && !/example\.|sentry|wixpress|png|jpg/i.test(visible[0])) email = visible[0].toLowerCase();
  }

  // Address: schema.org PostalAddress, else a UK postcode with its preceding line.
  let address = "";
  const street = jsonLdField(html, "streetAddress");
  if (street) {
    address = [street, jsonLdField(html, "addressLocality"), jsonLdField(html, "addressRegion"), jsonLdField(html, "postalCode")]
      .filter(Boolean)
      .join(", ");
  }
  if (!address) {
    const pc = textSample.match(/([A-Za-z0-9 ,.'&-]{10,80}?)\b([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\b/);
    if (pc) {
      const lead = pc[1].replace(/\s+/g, " ").replace(/^[^A-Za-z0-9]+/, "").trim();
      address = `${lead} ${pc[2]}`.trim();
    }
  }

  // Social profiles: the first non-generic link per network.
  const socialLinks: Record<string, string> = {};
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"'\s]+)["']/gi)) {
    const href = m[1];
    for (const [network, re] of Object.entries(SOCIAL_HOSTS)) {
      if (socialLinks[network]) continue;
      if (re.test(href) && !GENERIC_SOCIAL_PATH.test(href)) socialLinks[network] = href.split("?")[0].replace(/\/$/, "");
    }
  }

  return { phone, email, address, socialLinks };
}
