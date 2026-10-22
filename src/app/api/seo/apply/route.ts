// Apply one SEO audit fix LIVE — with honest tiers:
//  1. In-app site page (/s/<slug>…): structural fixes (title/meta/jsonld) are
//     applied to the Page's SEO fields, content fixes go through the designer
//     agent, then the site republishes in-app. Fully automatic.
//  2. WordPress content Prism itself published (ContentDraft by slug):
//     structural fixes update the draft and re-publish via the existing
//     WordPress upsert.
//  3. Anything else (WP pages Prism didn't author, theme-owned heads): we say
//     exactly why it can't be edited safely and hand back the paste-ready
//     values — loud honesty, never a pretended success.

import { db } from "@/lib/db";
import { generatePage, slugify } from "@/lib/builder";
import { publishSiteInApp, publishContentWordpress } from "@/lib/publish";
import type { SeoFix, SeoResearchData } from "@/lib/seo";
import { canTouch, getSessionUser } from "@/lib/auth";
import { track } from "@/lib/events";

export const maxDuration = 300;

function pathParts(targetUrl: string): { path: string; lastSlug: string } | null {
  try {
    const u = new URL(targetUrl);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const segs = path.split("/").filter(Boolean);
    return { path, lastSlug: segs[segs.length - 1] ?? "" };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { reportId?: string; fixIndex?: number } | null;
  if (!body?.reportId || body.fixIndex === undefined) {
    return Response.json({ error: "reportId and fixIndex are required." }, { status: 400 });
  }

  const report = await db.agentReport.findUnique({ where: { id: body.reportId } });
  if (!report || !report.kind.startsWith("seo_audit") || !report.data) {
    return Response.json({ error: "Audit report not found." }, { status: 404 });
  }
  const data = JSON.parse(report.data) as SeoResearchData;
  const fix: SeoFix | undefined = data.fixes?.[body.fixIndex];
  if (!fix) return Response.json({ error: "That fix isn't in this report." }, { status: 404 });
  if (!fix.targetUrl || !fix.fixKind) {
    return Response.json(
      { applied: false, message: "This audit predates one-click apply — run a fresh audit to get applicable fixes." },
      { status: 200 }
    );
  }

  const target = pathParts(fix.targetUrl);
  if (!target) {
    return Response.json({ applied: false, message: `The fix's page URL ("${fix.targetUrl}") isn't a valid URL.` });
  }

  try {
    // ── Tier 1: in-app hosted site page (/s/<slug>[/subpath]) ────────────────
    const inApp = target.path.match(/^\/s\/([^/]+)(\/.*)?$/);
    if (inApp) {
      const site = await db.site.findUnique({ where: { slug: inApp[1] }, include: { pages: true } });
      if (!site || !canTouch(site, user)) {
        return Response.json({ applied: false, message: "That in-app site isn't in your workspace." });
      }
      const pagePath = inApp[2] || "/";
      const page = site.pages.find((p) => p.path === pagePath) ?? site.pages.find((p) => p.isHome);
      if (!page) return Response.json({ applied: false, message: `No page at ${pagePath} on that site.` });

      if (fix.fixKind === "title") {
        await db.page.update({ where: { id: page.id }, data: { seoTitle: fix.exactChange } });
      } else if (fix.fixKind === "meta_description") {
        await db.page.update({ where: { id: page.id }, data: { seoDescription: fix.exactChange } });
      } else if (fix.fixKind === "jsonld") {
        await db.page.update({ where: { id: page.id }, data: { jsonLd: fix.jsonLd || fix.exactChange } });
      } else {
        // heading/content — the designer applies it to the page itself.
        const html = await generatePage({
          instruction: `Apply this SEO fix exactly, changing nothing else:\nProblem: ${fix.what}\nWhere: ${fix.where}\nCurrent: ${fix.currentValue}\nChange to: ${fix.exactChange}`,
          currentHtml: page.html,
          siteName: site.name,
          pageTitle: page.title,
          kind: site.kind,
          scopeUserId: site.userId,
        });
        await db.page.update({ where: { id: page.id }, data: { html } });
      }
      const result = await publishSiteInApp(site.id);
      track("seo_fix_applied", site.userId, { fixKind: fix.fixKind, tier: "in_app" });
      return Response.json({ applied: true, message: `Applied and republished at ${result.url}.`, url: result.url });
    }

    // ── Tier 2: WordPress content Prism published (ContentDraft by slug) ─────
    const draft = target.lastSlug
      ? await db.contentDraft.findFirst({
          where: { slug: slugify(target.lastSlug), status: "published", target: "wordpress", ...(user.role === "admin" ? {} : { userId: user.id }) },
        })
      : null;
    if (draft) {
      const patch: Record<string, string> = {};
      if (fix.fixKind === "title") patch.seoTitle = fix.exactChange;
      else if (fix.fixKind === "meta_description") patch.seoDescription = fix.exactChange;
      else if (fix.fixKind === "jsonld") patch.jsonLd = fix.jsonLd || fix.exactChange;
      else {
        return Response.json({
          applied: false,
          message:
            "Content-level edits to WordPress pieces aren't applied automatically (the page lives in WordPress's editor). Copy the change below and paste it in — everything structural (title, description, schema) applies with one click.",
        });
      }
      await db.contentDraft.update({ where: { id: draft.id }, data: patch });
      const result = await publishContentWordpress(draft.id);
      track("seo_fix_applied", draft.userId, { fixKind: fix.fixKind, tier: "wordpress" });
      return Response.json({
        applied: true,
        message: `Applied and re-published to WordPress${result.url ? ` at ${result.url}` : ""}.`,
        url: result.url,
      });
    }

    // ── Tier 3: not safely editable from here ────────────────────────────────
    return Response.json({
      applied: false,
      message:
        "This page is managed outside Prism (its theme owns the tags), so editing it from here could break things. The exact change is ready to paste — or ask us to rebuild the page in the Sites builder, where every fix applies with one click.",
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
