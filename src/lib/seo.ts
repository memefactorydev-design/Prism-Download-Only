// SEO/GEO audit orchestration (Phase 5): the backend fetches the live site
// (deterministic evidence — homepage, robots.txt, sitemap pages), then
// seo-geo-agent audits it with web_search/web_fetch for SERP and competitor
// checks. Output is a markdown fix list stored as an AgentReport; nothing is
// ever pushed live — every item is tagged [needs approval] by the agent.
//
// Google Business Profile: there is NO GBP API connection in this app, so GBP
// guidance is strategy based on public signals only — the agent is told to say
// so rather than implying it read the live profile.

import type { AgentReport } from "@prisma/client";
import { runAgent } from "@/lib/agents/run-agent";
import { googleSearch } from "@/lib/serp";
import { getBrandProfile } from "@/lib/brand-profile";

/** The site to audit and the SERP terms to check, from the scope's brand profile. */
async function auditTargetFor(scopeUserId: string): Promise<{ siteUrl: string; terms: string[] }> {
  const p = await getBrandProfile(scopeUserId);
  const siteUrl = p?.siteUrl?.trim();
  if (!siteUrl) {
    throw new Error("Add your website address on /brand (or run the guided setup at /welcome) so the audit knows which site to read.");
  }
  const keywords = (p?.keywords ?? "")
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const what = (p?.whatYouSell ?? "").split(/[.;\n]/)[0].trim().slice(0, 50);
  const where = (p?.serviceAreas ?? p?.region ?? "").split(/[,\n]/)[0].trim();
  const derived = what ? [where ? `${what} ${where}` : what, `${what} near me`] : [];
  return { siteUrl: /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`, terms: keywords.length ? keywords : derived };
}

// Structured, actionable audit (no minItems etc. — unsupported; validated after).
const SEO_SCHEMA = {
  type: "object",
  properties: {
    reportMarkdown: { type: "string", description: "Readable summary of the audit and priorities." },
    scoreSnapshot: { type: "string", description: "One-line health summary by area (SEO / GEO / local)." },
    fixes: {
      type: "array",
      description: "Prioritised, concrete fixes — strongest first.",
      items: {
        type: "object",
        properties: {
          area: { type: "string", description: "e.g. Title, Meta, Headings, Schema, Content, Internal links, GEO." },
          what: { type: "string", description: "The problem, in one line." },
          where: { type: "string", description: "The page/element it applies to, human-readable." },
          targetUrl: { type: "string", description: "The EXACT full URL of the page this fix applies to (from the fetched pages). Empty string only if truly site-wide." },
          fixKind: { type: "string", description: "Machine-applicable kind: title | meta_description | heading | jsonld | content | other" },
          currentValue: { type: "string", description: "The exact current value (or 'missing')." },
          exactChange: { type: "string", description: "The exact replacement to apply — ready to paste." },
          jsonLd: { type: "string", description: "A JSON-LD block to add, or empty string." },
          impact: { type: "string", description: "high | med | low" },
          effort: { type: "string", description: "high | med | low" },
        },
        required: ["area", "what", "where", "targetUrl", "fixKind", "currentValue", "exactChange", "jsonLd", "impact", "effort"],
        additionalProperties: false,
      },
    },
    keywords: {
      type: "array",
      description: "Target keywords with intent + opportunity, informed by the SERP evidence.",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          intent: { type: "string" },
          opportunity: { type: "string", description: "high | med | low, with a short why." },
        },
        required: ["keyword", "intent", "opportunity"],
        additionalProperties: false,
      },
    },
    contentIdeas: {
      type: "array",
      description: "Blog/FAQ pieces to create (feed the content generator).",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          targetKeyword: { type: "string" },
          type: { type: "string", description: "blog | faq" },
          intent: { type: "string" },
        },
        required: ["title", "targetKeyword", "type", "intent"],
        additionalProperties: false,
      },
    },
    gbpActions: { type: "array", description: "This week's Google Business Profile actions.", items: { type: "string" } },
    geoNotes: { type: "string", description: "GEO/LLM optimisation notes (entity clarity, answer-first, FAQ schema, llms.txt)." },
    caveats: { type: "array", description: "What could not be verified.", items: { type: "string" } },
  },
  required: ["reportMarkdown", "scoreSnapshot", "fixes", "keywords", "contentIdeas", "gbpActions", "geoNotes", "caveats"],
  additionalProperties: false,
};

export interface SeoFix {
  area: string;
  what: string;
  where: string;
  targetUrl?: string; // exact page URL (older reports lack it — Apply hidden then)
  fixKind?: string; // title | meta_description | heading | jsonld | content | other
  currentValue: string;
  exactChange: string;
  jsonLd: string;
  impact: string;
  effort: string;
}
export interface SeoResearchData {
  reportMarkdown: string;
  scoreSnapshot: string;
  fixes: SeoFix[];
  keywords: { keyword: string; intent: string; opportunity: string }[];
  contentIdeas: { title: string; targetKeyword: string; type: string; intent: string }[];
  gbpActions: string[];
  geoNotes: string;
  caveats: string[];
}
const PAGE_CHAR_LIMIT = 15_000;
const MAX_SITEMAP_PAGES = 4;

interface FetchedPage {
  url: string;
  status: number | string;
  content: string;
}

async function fetchPage(url: string): Promise<FetchedPage> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "PrismAI/1.0 (owner-run SEO audit)" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    return { url, status: res.status, content: text.slice(0, PAGE_CHAR_LIMIT) };
  } catch (err) {
    return { url, status: `FETCH FAILED: ${err instanceof Error ? err.message : String(err)}`, content: "" };
  }
}

function sitemapUrls(sitemapXml: string): string[] {
  return [...sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => !u.endsWith(".xml"));
}


/**
 * Structured, actionable SEO/GEO research: fetch the live site + scrape Google
 * SERPs for target terms (evidence), then the agent returns a structured fix
 * list, keyword table, content ideas, GBP actions and GEO notes we can render
 * and act on. Structured output can't use web tools, so SERP data comes from the
 * Apify scrape (falls back to "no SERP data" honestly when unavailable).
 */
export async function runSeoResearch(
  focus?: string,
  scopeUserId = ""
): Promise<{ report: AgentReport; data: SeoResearchData }> {
  const target = await auditTargetFor(scopeUserId);
  const base = target.siteUrl.replace(/\/$/, "");
  const [home, robots, sitemap] = await Promise.all([
    fetchPage(base + "/"),
    fetchPage(base + "/robots.txt"),
    fetchPage(base + "/sitemap.xml"),
  ]);
  const extraUrls = sitemapUrls(sitemap.content).filter((u) => u.replace(/\/$/, "") !== base).slice(0, MAX_SITEMAP_PAGES);
  const pages = [home, ...(await Promise.all(extraUrls.map(fetchPage)))];
  if (pages.every((p) => typeof p.status === "string" || p.status >= 400)) {
    throw new Error(`Could not fetch ${base} — ${String(home.status)}. Check the site is up and the address on /brand is right.`);
  }

  // SERP evidence (bonus — never fatal).
  const terms = (focus?.trim() ? [focus.trim(), ...target.terms] : target.terms).slice(0, 4);
  const serp: { term: string; results: { title?: string; url?: string; description?: string }[] }[] = [];
  const serpNotes: string[] = [];
  for (const term of terms) {
    const { items, error } = await googleSearch(term, 6);
    if (error) serpNotes.push(`"${term}": SERP unavailable (${error})`);
    else serp.push({ term, results: items });
  }

  // Real Search Console data when connected — measured queries/pages/positions
  // beat every scrape. Empty string when the connection isn't set up.
  const { searchPerformanceEvidence } = await import("@/lib/gsc");
  const gscEvidence = await searchPerformanceEvidence(scopeUserId);

  const task = [
    focus?.trim() ? `Audit focus: "${focus.trim()}".` : "Run a full structured SEO + GEO audit.",
    `Site: ${base} (live HTML fetched just now — trust it).`,
    "",
    gscEvidence ||
      "NOTE: Google Search Console is NOT connected — ranking/CTR claims below are inferences from scrapes, say so in caveats and recommend connecting GSC on the Connections page for measured data.",
    "",
    "## Live HTML (truncated)",
    ...pages.flatMap((p) => [`### ${p.url} (status ${p.status})`, "```html", p.content.slice(0, PAGE_CHAR_LIMIT) || "(no content)", "```", ""]),
    `### robots.txt (${robots.status})`,
    "```",
    robots.content.slice(0, 1500) || "(none)",
    "```",
    "",
    "## Google SERP evidence (scraped)",
    serp.length
      ? "```json\n" + JSON.stringify(serp, null, 2).slice(0, 30_000) + "\n```"
      : "No SERP scrape available — note this in caveats and base competitor/keyword guidance on the site + your knowledge.",
    serpNotes.length ? serpNotes.map((n) => `- ${n}`).join("\n") : "",
    "",
    "Return the STRUCTURED object: quote exact current values and give the exact replacement for each fix; include JSON-LD blocks where relevant; propose target keywords, blog/FAQ content ideas, GBP actions, and GEO notes (entity clarity, answer-first copy, FAQPage schema, llms.txt). For EVERY fix set targetUrl to the exact URL of the fetched page it applies to and fixKind to one of title|meta_description|heading|jsonld|content|other — these drive one-click apply. Be honest in caveats about anything unverifiable.",
  ].join("\n");

  const { report, data } = await runAgent<SeoResearchData>("seo-geo-agent", task, {
    schema: SEO_SCHEMA,
    maxTokens: 32000,
    // Scoped kind so each member's /seo page shows THEIR audits (same pattern
    // as ads_performance).
    reportKind: scopeUserId ? `seo_audit:${scopeUserId}` : "seo_audit",
    reportTitle: focus?.trim() ? `SEO/GEO audit: ${focus.trim()}` : "SEO/GEO audit",
    scopeUserId,
  });
  if (!data) throw new Error("seo-geo-agent returned no structured audit.");
  return { report, data };
}
