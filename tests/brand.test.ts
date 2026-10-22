// The brand brief and the onboarding extractors are pure; test them directly.
// Plus a repo-wide guard: no client brand may creep back into prompts or code.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { BrandProfile } from "@prisma/client";
import { BRIEF_SECTIONS, NEUTRAL_BRAND_NOTE, renderBrandBrief } from "../src/lib/brand-brief";
import { extractContacts } from "../src/lib/onboard-extract";

const base: BrandProfile = {
  id: "p1",
  userId: "",
  businessName: "Northside Physio",
  whatYouSell: "Private physiotherapy and sports rehab.",
  audience: "Active adults in north Leeds.",
  voice: null,
  region: null,
  goals: null,
  creativeLicence: null,
  channels: null,
  siteUrl: null,
  locations: null,
  serviceAreas: null,
  phone: null,
  email: null,
  address: null,
  products: null,
  priceBand: null,
  offers: null,
  usps: null,
  competitors: null,
  keywords: null,
  hashtags: null,
  palette: null,
  fonts: null,
  socialLinks: null,
  seasonality: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("renderBrandBrief", () => {
  it("renders only the sections that have content, in the contract order", () => {
    const brief = renderBrandBrief(base);
    assert.match(brief, /^# Brand brief — Northside Physio/);
    assert.match(brief, /## Overview[\s\S]*Private physiotherapy/);
    assert.match(brief, /## Audience/);
    assert.match(brief, /## Creative licence[\s\S]*BALANCED/);
    assert.doesNotMatch(brief, /## Locations & service areas/);
    assert.doesNotMatch(brief, /## Competitors/);
    assert.doesNotMatch(brief, /undefined|null/);
  });

  it("includes every section for a full profile and keeps JSON fields readable", () => {
    const full: BrandProfile = {
      ...base,
      voice: "warm, expert",
      region: "West Yorkshire",
      goals: "More first appointments",
      creativeLicence: "strict",
      channels: "instagram,facebook",
      siteUrl: "https://northsidephysio.example",
      locations: "Clinic at 12 High St, Chapel Allerton",
      serviceAreas: "Leeds, Harrogate",
      phone: "0113 000 0000",
      email: "hello@northsidephysio.example",
      address: "12 High St, Leeds LS7 4AA",
      products: "Physio, sports massage",
      priceBand: "£45–£70 per session",
      offers: "Free 15-minute phone consult",
      usps: "Same-week appointments; HCPC-registered",
      competitors: "City Physio, Rehab Hub",
      keywords: "physio leeds, sports massage leeds",
      hashtags: "northsidephysio, leedsphysio",
      palette: JSON.stringify(["#1a2b3c", "#f0f0f0"]),
      fonts: "Inter",
      socialLinks: JSON.stringify({ instagram: "https://instagram.com/northsidephysio" }),
      seasonality: "January resolutions; marathon season",
    };
    const brief = renderBrandBrief(full);
    for (const section of BRIEF_SECTIONS) assert.ok(brief.includes(`## ${section}`), `missing ${section}`);
    assert.match(brief, /Palette:\*\* #1a2b3c, #f0f0f0/);
    assert.match(brief, /instagram: https:\/\/instagram\.com\/northsidephysio/);
    assert.match(brief, /STRICT/);
    assert.match(brief, /0113 000 0000 · hello@northsidephysio\.example · 12 High St/);
  });

  it("has a neutral note that points at setup", () => {
    assert.match(NEUTRAL_BRAND_NOTE, /not set up yet/);
    assert.match(NEUTRAL_BRAND_NOTE, /\/welcome/);
  });
});

describe("extractContacts", () => {
  const html = `
    <html><body>
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
      <a href="https://www.instagram.com/northsidephysio/">Instagram</a>
      <a href="https://www.facebook.com/NorthsidePhysio">Facebook</a>
      <a href="tel:+44 113 000 0000">Call us</a>
      <a href="mailto:hello@northsidephysio.example?subject=Hi">Email</a>
      <script type="application/ld+json">{"@type":"Physiotherapy","address":{"@type":"PostalAddress","streetAddress":"12 High St","addressLocality":"Leeds","postalCode":"LS7 4AA"}}</script>
    </body></html>`;
  it("reads tel:, mailto:, schema.org address and the first real social link per network", () => {
    const c = extractContacts(html, "Visit us at 12 High St Leeds LS7 4AA");
    assert.equal(c.phone, "+44 113 000 0000");
    assert.equal(c.email, "hello@northsidephysio.example");
    assert.equal(c.address, "12 High St, Leeds, LS7 4AA");
    assert.equal(c.socialLinks.instagram, "https://www.instagram.com/northsidephysio");
    assert.equal(c.socialLinks.facebook, "https://www.facebook.com/NorthsidePhysio");
  });
  it("falls back to visible text and a UK postcode", () => {
    const c = extractContacts("<html></html>", "Call 0113 123 4567 or write to hello@millsite.org. Find us at Unit 4, Mill Lane, Leeds LS1 2AB today.");
    assert.equal(c.phone, "0113 123 4567");
    assert.equal(c.email, "hello@millsite.org");
    assert.match(c.address, /Mill Lane, Leeds LS1 2AB$/);
  });
});

describe("no client brand in the shipped tree", () => {
  it("prompts, code and docs never name a client business", () => {
    const root = path.resolve(__dirname, "..");
    const files = execFileSync("git", ["ls-files", "agents", ".claude/agents", "src", "prisma/schema.prisma", "README.md", "AGENTS.md", ".env.example"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const banned = /sheraton|twickenham|0208 894|TW2 7LD|SL1 4NL|tom howley|harvey jones/i;
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(path.join(root, f), "utf8");
      const line = text.split("\n").findIndex((l) => banned.test(l));
      if (line !== -1) offenders.push(`${f}:${line + 1}`);
    }
    assert.deepEqual(offenders, []);
  });
});
