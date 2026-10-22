// Blog + FAQ content generation: content-writer-agent produces an SEO+GEO
// optimised piece (structured), stored as a ContentDraft ready to preview and
// publish via the publish subsystem.

import type { ContentDraft } from "@prisma/client";
import { runAgent } from "@/lib/agents/run-agent";
import { db } from "@/lib/db";
import { slugify } from "@/lib/builder";

const CONTENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    slug: { type: "string" },
    bodyHtml: { type: "string", description: "Semantic HTML body (no document wrapper)." },
    excerpt: { type: "string" },
    seoTitle: { type: "string" },
    seoDescription: { type: "string" },
    keywords: { type: "string", description: "Comma-separated." },
    jsonLd: { type: "string", description: "Article or FAQPage JSON-LD." },
  },
  required: ["title", "slug", "bodyHtml", "excerpt", "seoTitle", "seoDescription", "keywords", "jsonLd"],
  additionalProperties: false,
};

interface ContentPayload {
  title: string;
  slug: string;
  bodyHtml: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  keywords: string;
  jsonLd: string;
}

export async function generateContent(opts: {
  kind: "blog" | "faq";
  topic: string;
  keyword?: string;
  notes?: string;
}, scopeUserId = ""): Promise<ContentDraft> {
  if (!opts.topic.trim()) throw new Error("Enter a topic to write about.");
  const task = [
    `Write a ${opts.kind === "faq" ? "FAQ page" : "blog post"} about: "${opts.topic.trim()}".`,
    opts.keyword?.trim() ? `Primary keyword to target: "${opts.keyword.trim()}".` : "",
    opts.notes?.trim() ? `Extra guidance: ${opts.notes.trim()}` : "",
    "",
    `Make it SEO + GEO optimised (answer-first, ${opts.kind === "faq" ? "FAQPage" : "Article"} JSON-LD). Return the structured object.`,
  ].join("\n");

  const { data } = await runAgent<ContentPayload>("content-writer-agent", task, {
    schema: CONTENT_SCHEMA,
    maxTokens: 16000,
    reportKind: "content_draft",
    reportTitle: `${opts.kind === "faq" ? "FAQ" : "Blog"}: ${opts.topic.trim()}`,
    scopeUserId,
  });
  if (!data) throw new Error("content-writer-agent returned nothing.");

  return db.contentDraft.create({
    data: {
      userId: scopeUserId,
      kind: opts.kind,
      title: data.title,
      slug: slugify(data.slug || data.title),
      bodyHtml: data.bodyHtml,
      excerpt: data.excerpt || null,
      seoTitle: data.seoTitle || null,
      seoDescription: data.seoDescription || null,
      keywords: data.keywords || null,
      jsonLd: data.jsonLd || null,
    },
  });
}

export async function listDrafts(
  actor?: { id: string; role: string },
  limit = 30
): Promise<ContentDraft[]> {
  return db.contentDraft.findMany({
    where: actor && actor.role !== "admin" ? { userId: actor.id } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
