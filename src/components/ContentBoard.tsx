"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { WorkingState } from "@/components/ui/Loading";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconSparkles } from "@/components/ui/icons";

export interface DraftRow {
  id: string;
  kind: string;
  title: string;
  slug: string;
  bodyHtml: string;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  keywords: string | null;
  jsonLd: string | null;
  status: string;
  publishedUrl: string | null;
  createdAt: string;
}

export function ContentBoard({ drafts }: { drafts: DraftRow[] }) {
  const router = useRouter();
  const [kind, setKind] = useState("blog");
  const [topic, setTopic] = useState("");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!topic.trim()) {
      setError("Enter a topic.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, topic, keyword: keyword || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "Generation failed.");
    } else {
      setTopic("");
      setKeyword("");
    }
    router.refresh();
  }

  return (
    <div>
      <div className="card p-5">
        <h2 className="font-display text-base font-semibold text-foreground">
          Generate SEO + GEO content
        </h2>
        <p className="mt-1 text-sm text-muted">
          Blog posts and FAQ pages, answer-first for LLMs, with Article/FAQPage
          schema.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label>
            <span className="mb-1 block text-xs text-muted">Type</span>
            <select
              className="input w-auto"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="blog">Blog post</option>
              <option value="faq">FAQ page</option>
            </select>
          </label>
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-xs text-muted">Topic</span>
            <input
              className="input"
              placeholder="e.g. How much does [your service] cost in the UK?"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
          <label className="min-w-40 flex-1">
            <span className="mb-1 block text-xs text-muted">
              Target keyword (optional)
            </span>
            <input
              className="input"
              placeholder="your service cost uk"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </label>
          <button
            onClick={generate}
            disabled={busy}
            className="btn btn-primary"
          >
            <IconSparkles className="h-4 w-4" />
            {busy ? "Writing…" : "Generate"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}

        {busy && (
          <WorkingState
            messages={[
              "Researching your topic…",
              "Structuring the article…",
              "Writing answer-first copy…",
              "Adding the schema markup…",
            ]}
            progress={null}
            className="mt-4"
          />
        )}
      </div>

      {drafts.length === 0 ? (
        busy ? null : (
          <EmptyState className="mt-8" image="/empty/content.webp" title="Your first article is one topic away.">
            Give the writer a topic above and it researches, structures and drafts answer-first SEO
            content — with the schema markup already in place.
          </EmptyState>
        )
      ) : (
        <div className="mt-6 space-y-3">
          {drafts.map((d, i) => (
            <Reveal key={d.id} i={i}>
              <DraftCard draft={d} onChanged={() => router.refresh()} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftCard({
  draft,
  onChanged,
}: {
  draft: DraftRow;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const preview = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-white text-zinc-900"><main class="mx-auto max-w-2xl px-6 py-8 prose prose-zinc">${draft.bodyHtml}</main></body></html>`;

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/content/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const b = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
    setBusy(false);
    setMsg(res.ok ? (b.url ? `${ok} → ${b.url}` : ok) : (b.error ?? "Failed."));
    if (res.ok) onChanged();
  }

  async function remove() {
    if (!confirm("Delete this draft?")) return;
    setBusy(true);
    await fetch(`/api/content/${draft.id}`, { method: "DELETE" });
    setBusy(false);
    onChanged();
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge bg-accent-soft text-accent">{draft.kind}</span>
        <span className="font-medium text-foreground">{draft.title}</span>
        <span
          className={`badge ${draft.status === "published" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-foreground/8 text-muted"}`}
        >
          {draft.status}
        </span>
        {draft.publishedUrl && (
          <a
            href={draft.publishedUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:underline"
          >
            view
          </a>
        )}
      </div>
      {draft.seoDescription && (
        <p className="mt-1.5 text-sm text-muted">{draft.seoDescription}</p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">
          Preview
        </summary>
        <iframe
          title={draft.title}
          srcDoc={preview}
          sandbox="allow-scripts"
          className="mt-2 h-96 w-full rounded-xl border border-border bg-white"
        />
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() =>
            act(
              { action: "publish", target: "wordpress" },
              "Published to WordPress",
            )
          }
          disabled={busy}
          className="btn btn-secondary text-xs"
        >
          Publish to WordPress
        </button>
        <button
          onClick={() =>
            act({ action: "publish", target: "ftp" }, "Published via FTP")
          }
          disabled={busy}
          className="btn btn-secondary text-xs"
        >
          Publish via FTP
        </button>
        <button
          onClick={async () => {
            setBusy(true);
            const res = await fetch(`/api/content/${draft.id}/refract`, { method: "POST" });
            const b = (await res.json().catch(() => ({}))) as { channels?: string[]; error?: string };
            setBusy(false);
            setMsg(res.ok ? `Refracted into ${b.channels?.length ?? 0} social teasers — they're in your calendar.` : b.error ?? "Refraction failed.");
          }}
          disabled={busy}
          className="btn btn-secondary text-xs"
          title="One tap: native social teasers for this piece, as drafts"
        >
          ✦ Refract into social
        </button>
        <CopyBtn label="Copy HTML" value={draft.bodyHtml} />
        {draft.jsonLd && <CopyBtn label="Copy JSON-LD" value={draft.jsonLd} />}
        <button
          onClick={remove}
          disabled={busy}
          className="btn btn-ghost text-xs text-danger"
        >
          Delete
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
    </div>
  );
}

function CopyBtn({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
      className="btn btn-secondary text-xs"
    >
      {done ? "Copied" : label}
    </button>
  );
}
