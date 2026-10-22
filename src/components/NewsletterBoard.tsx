"use client";

// Newsletter studio: compose (or have the writer agent draft), preview, pick
// the audience, send. Sending is a deliberate second step — you're emailing
// real people — and the worker does the actual delivery.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface NewsletterDTO {
  id: string;
  subject: string;
  bodyHtml: string;
  status: string;
  audience: string;
  sentCount: number;
  failedCount: number;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

const AUDIENCES = [
  { value: "subscribed", label: "All subscribed leads" },
  { value: "status:new", label: "Subscribed · New" },
  { value: "status:contacted", label: "Subscribed · Contacted" },
  { value: "status:booked", label: "Subscribed · Booked" },
  { value: "status:callback", label: "Subscribed · Callback" },
];

const STATUS_TONE: Record<string, string> = {
  draft: "bg-foreground/10 text-muted",
  approved: "bg-amber-500/15 text-amber-500",
  sending: "bg-amber-500/15 text-amber-500",
  sent: "bg-emerald-500/15 text-emerald-500",
  failed: "bg-red-500/15 text-red-400",
};

export function NewsletterBoard({ initial, smtpConnected }: { initial: NewsletterDTO[]; smtpConnected: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [audience, setAudience] = useState("subscribed");
  const [topic, setTopic] = useState("");
  // The designer: prompt-driven email design with a live preview, iterated
  // one instruction at a time (same rhythm as the website builder).
  const [designPrompt, setDesignPrompt] = useState("");
  const [designHtml, setDesignHtml] = useState("");
  const [designSubject, setDesignSubject] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<NewsletterDTO | null>(null);

  const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  const call = async (url: string, init: RequestInit, busyKey: string) => {
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    const body = (await res.json().catch(() => ({}))) as {
      newsletter?: NewsletterDTO;
      recipients?: number;
      error?: string;
    };
    setBusy(null);
    if (!res.ok) {
      setError(body.error ?? `Request failed (HTTP ${res.status}).`);
      return null;
    }
    return body;
  };

  const design = async () => {
    setBusy("design");
    setError(null);
    setNotice(null);
    const res = await fetch("/api/newsletter/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: designPrompt, currentHtml: designHtml }),
    });
    const body = (await res.json().catch(() => ({}))) as { html?: string; error?: string };
    setBusy(null);
    if (!res.ok || !body.html) {
      setError(body.error ?? `Design failed (HTTP ${res.status}).`);
      return;
    }
    setDesignHtml(body.html);
    setDesignPrompt("");
  };

  const saveDesign = async () => {
    if (!designSubject.trim()) {
      setError("Give the designed email a subject before saving.");
      return;
    }
    const body = await call(
      "/api/newsletter",
      { method: "POST", body: JSON.stringify({ subject: designSubject, bodyHtml: designHtml, audience }) },
      "savedesign"
    );
    if (body?.newsletter) {
      setItems((l) => [body.newsletter!, ...l]);
      setNotice(`Design saved as a draft — ${body.recipients} recipient(s) in this audience.`);
      setDesignHtml("");
      setDesignSubject("");
      router.refresh();
    }
  };

  const draftWithAi = async () => {
    const body = await call("/api/newsletter", { method: "POST", body: JSON.stringify({ draftWithAi: true, topic, audience }) }, "ai");
    if (body?.newsletter) {
      setItems((l) => [body.newsletter!, ...l]);
      setNotice(`Draft written — ${body.recipients} recipient(s) in this audience. Review it below, then send.`);
      setTopic("");
      router.refresh();
    }
  };

  const saveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = await call("/api/newsletter", { method: "POST", body: JSON.stringify({ subject, bodyHtml, audience }) }, "save");
    if (body?.newsletter) {
      setItems((l) => [body.newsletter!, ...l]);
      setSubject("");
      setBodyHtml("");
      setNotice(`Draft saved — ${body.recipients} recipient(s) in this audience.`);
      router.refresh();
    }
  };

  const send = async (id: string) => {
    if (!smtpConnected) {
      setError("Connect your email service on the Connections page first — there's nothing to send with yet.");
      return;
    }
    const body = await call(`/api/newsletter/${id}`, { method: "PATCH", body: JSON.stringify({ action: "send" }) }, id);
    if (body?.newsletter) {
      setItems((l) => l.map((n) => (n.id === id ? body.newsletter! : n)));
      setNotice(`Queued — Prism is sending to ${body.recipients} recipient(s). Refresh for progress.`);
      router.refresh();
    }
  };

  const remove = async (id: string) => {
    setItems((l) => l.filter((n) => n.id !== id));
    await fetch(`/api/newsletter/${id}`, { method: "DELETE" });
  };

  return (
    <div>
      {!smtpConnected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-400">
          Your email service isn&rsquo;t connected yet. Drafts save fine, but nothing can send until you add your email provider on the Connections page.
        </div>
      )}

      {/* The designer: describe it, watch it take shape, refine, save. */}
      <div className="mt-5 rounded-2xl border border-border p-4">
        <p className="text-sm font-medium">🎨 Design with AI</p>
        <p className="mt-1 text-xs text-muted">
          Describe the email you want — layout, mood, sections — and refine it one instruction at a time. The
          preview updates live.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            className={input}
            placeholder={designHtml ? "Refine it — e.g. 'make the header darker, add a two-offer section'" : "e.g. 'A premium dark announcement email for our spring collection with one big CTA'"}
            value={designPrompt}
            onChange={(e) => setDesignPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && designPrompt.trim() && design()}
          />
          <button
            onClick={design}
            disabled={busy === "design" || !designPrompt.trim()}
            className="shrink-0 rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "design" ? "Designing…" : designHtml ? "Apply change" : "Design it"}
          </button>
        </div>
        {designHtml && (
          <div className="mt-4">
            <iframe
              srcDoc={designHtml}
              sandbox=""
              title="Email design preview"
              className="h-[480px] w-full rounded-xl border border-border bg-white"
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                className={input}
                placeholder="Subject line for this email"
                value={designSubject}
                onChange={(e) => setDesignSubject(e.target.value)}
              />
              <button
                onClick={saveDesign}
                disabled={busy === "savedesign"}
                className="shrink-0 rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === "savedesign" ? "Saving…" : "Save as draft"}
              </button>
              <button
                onClick={() => {
                  setDesignHtml("");
                  setDesignSubject("");
                }}
                className="shrink-0 rounded-lg border border-border px-4 py-2 text-sm text-muted"
              >
                Start over
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AI draft */}
      <div className="mt-4 rounded-2xl border border-border p-4">
        <p className="text-sm font-medium">✨ Draft with AI</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input className={input} placeholder="Topic — e.g. 'Autumn trends + this month's availability'" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <button onClick={draftWithAi} disabled={busy === "ai" || !topic.trim()} className="shrink-0 rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy === "ai" ? "Writing…" : "Write the issue"}
          </button>
        </div>
      </div>

      {/* Manual compose */}
      <form onSubmit={saveDraft} className="mt-4 space-y-3 rounded-2xl border border-border p-4">
        <p className="text-sm font-medium">Compose</p>
        <input className={input} required placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className={input} rows={8} required placeholder="Body (HTML or plain paragraphs)" value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={audience} onChange={(e) => setAudience(e.target.value)}>
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <button type="submit" disabled={busy === "save"} className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
        </div>
      </form>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      {notice && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}

      {/* Issues */}
      <div className="mt-6 space-y-3">
        {items.map((n) => (
          <div key={n.id} className="rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-medium">{n.subject}</p>
              <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold capitalize ${STATUS_TONE[n.status] ?? STATUS_TONE.draft}`}>
                {n.status}
              </span>
              <span className="text-xs text-muted">{AUDIENCES.find((a) => a.value === n.audience)?.label ?? n.audience}</span>
              {n.status === "sent" && (
                <span className="text-xs text-muted">
                  {n.sentCount} sent{n.failedCount ? ` · ${n.failedCount} failed` : ""} · {n.sentAt ? new Date(n.sentAt).toLocaleString("en-GB") : ""}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => setPreview(preview?.id === n.id ? null : n)} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground">
                  {preview?.id === n.id ? "Hide" : "Preview"}
                </button>
                {(n.status === "draft" || n.status === "failed") && (
                  <button onClick={() => send(n.id)} disabled={busy === n.id} className="rounded-md bg-gradient-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                    {busy === n.id ? "Queueing…" : "Send"}
                  </button>
                )}
                {n.status !== "sending" && n.status !== "approved" && (
                  <button onClick={() => remove(n.id)} className="text-xs text-red-400 hover:text-red-500">
                    Delete
                  </button>
                )}
              </div>
            </div>
            {n.errorMessage && <p className="mt-2 text-sm text-red-500">{n.errorMessage}</p>}
            {preview?.id === n.id && (
              <div className="mt-3 rounded-xl border border-border bg-white p-5 text-black" dangerouslySetInnerHTML={{ __html: n.bodyHtml }} />
            )}
          </div>
        ))}
        {items.length === 0 && <p className="py-6 text-center text-sm text-muted">No newsletters yet — draft one above.</p>}
      </div>
    </div>
  );
}
