// Publish/deploy subsystem — one place that pushes built pages and generated
// content live, to pluggable targets:
//   in_app    → serve from this app at /s/<slug> (owner-hosted)
//   export    → return a self-contained HTML string (route streams a download)
//   wordpress → create/update a WP page/post via the REST API
//   ftp       → upload static HTML over SFTP/FTP to a configured host
//
// External targets (wordpress/ftp) touch a production site, so callers must have
// the owner explicitly confirm; every attempt is written to PublishLog for audit.
// Secrets come from the encrypted Connection store (getSecrets).

import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { getSecrets } from "@/lib/connections";
import { track } from "@/lib/events";

export type PublishTarget = "in_app" | "export" | "wordpress" | "ftp";

export interface PublishResult {
  ok: boolean;
  url?: string;
  message?: string;
}

// Wrap a body fragment (e.g. a blog/FAQ draft) into a clean, responsive,
// SEO-scaffolded HTML document for in-app/FTP hosting.
export function wrapHtml(opts: {
  title: string;
  description?: string | null;
  bodyHtml: string;
  jsonLd?: string | null;
}): string {
  const desc = (opts.description ?? "").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
${desc ? `<meta name="description" content="${desc}" />` : ""}
<script src="https://cdn.tailwindcss.com"></script>
${opts.jsonLd ? `<script type="application/ld+json">${opts.jsonLd}</script>` : ""}
</head>
<body class="bg-white text-zinc-900">
<main class="mx-auto max-w-3xl px-6 py-12 prose prose-zinc">
${opts.bodyHtml}
</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function log(entry: {
  targetType: PublishTarget;
  targetRef?: string;
  siteId?: string;
  pageId?: string;
  contentDraftId?: string;
  ok: boolean;
  message?: string;
  url?: string;
}) {
  await db.publishLog.create({ data: entry });
}

// ─── In-app hosting ──────────────────────────────────────────────────────────

/**
 * Inject a page's stored SEO fields (seoTitle/seoDescription/jsonLd) into its
 * self-contained HTML head — this is what makes the Page SEO columns REAL for
 * in-app hosting (and what "Apply" on the SEO audit relies on).
 */
export function injectSeoHead(
  html: string,
  seo: { seoTitle?: string | null; seoDescription?: string | null; jsonLd?: string | null }
): string {
  let out = html;
  if (seo.seoTitle?.trim()) {
    const title = `<title>${escapeHtml(seo.seoTitle.trim())}</title>`;
    out = /<title[^>]*>[\s\S]*?<\/title>/i.test(out)
      ? out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, title)
      : out.replace(/<head([^>]*)>/i, `<head$1>\n${title}`);
  }
  if (seo.seoDescription?.trim()) {
    const desc = `<meta name="description" content="${seo.seoDescription.trim().replace(/"/g, "&quot;")}" />`;
    out = /<meta\s+name=["']description["'][^>]*>/i.test(out)
      ? out.replace(/<meta\s+name=["']description["'][^>]*\/?>/i, desc)
      : out.replace(/<head([^>]*)>/i, `<head$1>\n${desc}`);
  }
  if (seo.jsonLd?.trim()) {
    const block = `<script type="application/ld+json">${seo.jsonLd.trim()}</script>`;
    // replace an existing ld+json block, else add before </head>
    out = /<script\s+type=["']application\/ld\+json["'][\s\S]*?<\/script>/i.test(out)
      ? out.replace(/<script\s+type=["']application\/ld\+json["'][\s\S]*?<\/script>/i, block)
      : out.replace(/<\/head>/i, `${block}\n</head>`);
  }
  return out;
}

/** Snapshot every page's working HTML (with SEO head injected) as its published HTML; served at /s/<slug>. */
export async function publishSiteInApp(siteId: string): Promise<PublishResult> {
  const site = await db.site.findUnique({ where: { id: siteId }, include: { pages: true } });
  if (!site) throw new Error("Site not found.");
  if (!site.pages.length) throw new Error("This site has no pages yet.");
  for (const p of site.pages) {
    await db.page.update({
      where: { id: p.id },
      data: { publishedHtml: injectSeoHead(p.html, p) },
    });
  }
  const url = `/s/${site.slug}`;
  await db.site.update({ where: { id: siteId }, data: { status: "published", publishedUrl: url } });
  await log({ targetType: "in_app", targetRef: url, siteId, ok: true, url });
  track("site_published", site.userId, { target: "in_app", siteId });
  return { ok: true, url };
}

// ─── WordPress ───────────────────────────────────────────────────────────────

async function wpAuth() {
  const s = await getSecrets("wordpress");
  if (!s) throw new Error("WordPress is not connected yet. Add it on the Connections page.");
  const base = s.siteUrl.replace(/\/$/, "");
  const auth = Buffer.from(`${s.username}:${s.appPassword.replace(/\s+/g, "")}`).toString("base64");
  return { base, headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" } };
}

/** Create or update (by slug) a WordPress page or post. */
async function wpUpsert(
  type: "pages" | "posts",
  payload: { title: string; content: string; slug: string; excerpt?: string }
): Promise<PublishResult> {
  const { base, headers } = await wpAuth();
  // Find an existing item with this slug (any status) to update instead of duplicate.
  const findRes = await fetch(`${base}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(payload.slug)}&status=publish,draft,pending,private&per_page=1`, {
    headers,
  });
  let existingId: number | null = null;
  if (findRes.ok) {
    const found = (await findRes.json()) as { id: number }[];
    if (Array.isArray(found) && found[0]?.id) existingId = found[0].id;
  }
  const url = `${base}/wp-json/wp/v2/${type}${existingId ? `/${existingId}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: payload.title,
      content: payload.content,
      slug: payload.slug,
      excerpt: payload.excerpt ?? "",
      status: "publish",
    }),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`WordPress rejected the publish (HTTP ${res.status}): ${text}`);
  }
  const json = (await res.json()) as { link?: string };
  return { ok: true, url: json.link };
}

export async function publishSiteWordpress(siteId: string): Promise<PublishResult> {
  const site = await db.site.findUnique({ where: { id: siteId }, include: { pages: { orderBy: { order: "asc" } } } });
  if (!site) throw new Error("Site not found.");
  let firstUrl: string | undefined;
  try {
    for (const p of site.pages) {
      const slug = pageSlug(site.slug, p.path, p.isHome);
      const r = await wpUpsert("pages", { title: p.title, content: p.html, slug });
      firstUrl = firstUrl ?? r.url;
    }
    await log({ targetType: "wordpress", targetRef: firstUrl, siteId, ok: true, url: firstUrl });
    return { ok: true, url: firstUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log({ targetType: "wordpress", siteId, ok: false, message });
    throw err;
  }
}

export async function publishContentWordpress(draftId: string): Promise<PublishResult> {
  const d = await db.contentDraft.findUnique({ where: { id: draftId } });
  if (!d) throw new Error("Draft not found.");
  try {
    const r = await wpUpsert(d.kind === "blog" ? "posts" : "pages", {
      title: d.seoTitle || d.title,
      content: d.jsonLd ? `${d.bodyHtml}\n<script type="application/ld+json">${d.jsonLd}</script>` : d.bodyHtml,
      slug: d.slug,
      excerpt: d.excerpt ?? d.seoDescription ?? "",
    });
    await db.contentDraft.update({ where: { id: draftId }, data: { status: "published", target: "wordpress", publishedUrl: r.url ?? null } });
    await log({ targetType: "wordpress", targetRef: r.url, contentDraftId: draftId, ok: true, url: r.url });
    return r;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log({ targetType: "wordpress", contentDraftId: draftId, ok: false, message });
    throw err;
  }
}

// ─── FTP / SFTP ──────────────────────────────────────────────────────────────

/** Upload a set of { remotePath, html } files to the configured FTP/SFTP host. */
async function ftpUpload(files: { remotePath: string; html: string }[]): Promise<string> {
  const s = await getSecrets("ftp");
  if (!s) throw new Error("FTP/SFTP is not connected yet. Add it on the Connections page.");
  const port = Number(s.port) || (s.protocol === "ftp" ? 21 : 22);
  const baseDir = (s.baseDir || "/").replace(/\/$/, "");

  if (s.protocol === "sftp") {
    const { default: SftpClient } = await import("ssh2-sftp-client");
    const client = new SftpClient();
    await client.connect({ host: s.host, port, username: s.user, password: s.password });
    try {
      for (const f of files) {
        const full = `${baseDir}/${f.remotePath}`.replace(/\/+/g, "/");
        const dir = full.slice(0, full.lastIndexOf("/"));
        if (dir) await client.mkdir(dir, true).catch(() => {});
        await client.put(Buffer.from(f.html, "utf8"), full);
      }
    } finally {
      await client.end().catch(() => {});
    }
  } else {
    const { Client } = await import("basic-ftp");
    const client = new Client(20_000);
    await client.access({ host: s.host, port, user: s.user, password: s.password, secure: false });
    try {
      for (const f of files) {
        const full = `${baseDir}/${f.remotePath}`.replace(/\/+/g, "/");
        const dir = full.slice(0, full.lastIndexOf("/")) || "/";
        await client.ensureDir(dir);
        await client.uploadFrom(Readable.from(f.html), full.slice(full.lastIndexOf("/") + 1));
        await client.cd(baseDir).catch(() => {});
      }
    } finally {
      client.close();
    }
  }
  return (s.publicBaseUrl || "").replace(/\/$/, "");
}

export async function publishSiteFtp(siteId: string): Promise<PublishResult> {
  const site = await db.site.findUnique({ where: { id: siteId }, include: { pages: { orderBy: { order: "asc" } } } });
  if (!site) throw new Error("Site not found.");
  try {
    const files = site.pages.map((p) => ({ remotePath: ftpPath(p.path, p.isHome), html: p.html }));
    const publicBase = await ftpUpload(files);
    const url = publicBase || undefined;
    await log({ targetType: "ftp", targetRef: url, siteId, ok: true, url });
    return { ok: true, url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log({ targetType: "ftp", siteId, ok: false, message });
    throw err;
  }
}

export async function publishContentFtp(draftId: string): Promise<PublishResult> {
  const d = await db.contentDraft.findUnique({ where: { id: draftId } });
  if (!d) throw new Error("Draft not found.");
  try {
    const html = wrapHtml({ title: d.seoTitle || d.title, description: d.seoDescription, bodyHtml: d.bodyHtml, jsonLd: d.jsonLd });
    const dir = d.kind === "blog" ? "blog" : "faq";
    const publicBase = await ftpUpload([{ remotePath: `${dir}/${d.slug}/index.html`, html }]);
    const url = publicBase ? `${publicBase}/${dir}/${d.slug}/` : undefined;
    await db.contentDraft.update({ where: { id: draftId }, data: { status: "published", target: "ftp", publishedUrl: url ?? null } });
    await log({ targetType: "ftp", targetRef: url, contentDraftId: draftId, ok: true, url });
    return { ok: true, url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log({ targetType: "ftp", contentDraftId: draftId, ok: false, message });
    throw err;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function ftpPath(path: string, isHome: boolean): string {
  if (isHome || path === "/" || path === "") return "index.html";
  const clean = path.replace(/^\/+|\/+$/g, "");
  return `${clean}/index.html`;
}

function pageSlug(siteSlug: string, path: string, isHome: boolean): string {
  if (isHome || path === "/" || path === "") return siteSlug;
  return `${siteSlug}-${path.replace(/^\/+|\/+$/g, "").replace(/\//g, "-")}`;
}
