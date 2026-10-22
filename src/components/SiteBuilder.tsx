"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { motion } from "motion/react";
import { LogoMark } from "@/components/ui/Logo";
import {
  IconSparkles,
  IconSend,
  IconDownload,
  IconRocket,
  IconArrowRight,
} from "@/components/ui/icons";

interface PageData {
  id: string;
  path: string;
  isHome: boolean;
  title: string;
  html: string;
  seoTitle: string | null;
  seoDescription: string | null;
}
interface Msg {
  id: string;
  role: string;
  content: string;
  pageId: string | null;
}
export interface BuilderData {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  publishedUrl: string | null;
  pages: PageData[];
  messages: Msg[];
}

export function SiteBuilder({ data }: { data: BuilderData }) {
  const router = useRouter();
  const [pages, setPages] = useState<PageData[]>(data.pages);
  const [currentId, setCurrentId] = useState<string>(
    data.pages.find((p) => p.isHome)?.id ?? data.pages[0]?.id,
  );
  const [messages, setMessages] = useState<Msg[]>(data.messages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const page = pages.find((p) => p.id === currentId) ?? pages[0];

  function updatePage(id: string, html: string) {
    setPages((ps) => ps.map((p) => (p.id === id ? { ...p, html } : p)));
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setNotice(null);
    const uid = `u-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: uid, role: "user", content: text, pageId: currentId },
    ]);
    setBusy(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9 }));
    try {
      const res = await fetch(`/api/sites/${data.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, pageId: currentId }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Generation failed (HTTP ${res.status}).`);
      }
      // NDJSON stream: progress frames grow the preview live while the
      // designer writes; "media" marks the imagery phase; "done" is final.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalHtml: string | null = null;
      let streamError: string | null = null;
      const handle = (line: string) => {
        if (!line.trim()) return;
        try {
          const evt = JSON.parse(line) as { type: string; html?: string; note?: string; error?: string };
          if (evt.type === "progress" && evt.html) updatePage(currentId, evt.html);
          else if (evt.type === "media") setNotice(evt.note ?? "Generating the imagery…");
          else if (evt.type === "done" && evt.html) finalHtml = evt.html;
          else if (evt.type === "error") streamError = evt.error ?? "Generation failed.";
        } catch {
          /* partial line — wait for more */
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        lines.forEach(handle);
      }
      handle(buf);
      setNotice(null);
      if (streamError) throw new Error(streamError);
      if (finalHtml) {
        updatePage(currentId, finalHtml);
        setMessages((m) => [
          ...m,
          { id: `a-${Date.now()}`, role: "assistant", content: "✨ Updated the page.", pageId: currentId },
        ]);
      } else {
        throw new Error("The stream ended without a finished page — try again.");
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: `⚠️ ${e instanceof Error ? e.message : String(e)}`,
          pageId: currentId,
        },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9 }));
    }
  }

  async function addPage() {
    const path = prompt("New page path (e.g. /pricing):");
    if (!path) return;
    const res = await fetch(`/api/sites/${data.id}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      error?: string;
    };
    if (res.ok && body.id) {
      const clean = path.startsWith("/") ? path : "/" + path;
      setPages((ps) => [
        ...ps,
        {
          id: body.id!,
          path: clean,
          isHome: false,
          title: clean.slice(1),
          html: "",
          seoTitle: null,
          seoDescription: null,
        },
      ]);
      setCurrentId(body.id!);
    } else setNotice(body.error ?? "Could not add page.");
  }

  async function publish(target: "in_app" | "wordpress" | "ftp") {
    if (
      target !== "in_app" &&
      !confirm(
        `Publish "${data.name}" live to ${target === "wordpress" ? "WordPress" : "your FTP host"}? This pushes to a production site.`,
      )
    )
      return;
    setPublishing(true);
    setNotice(null);
    const res = await fetch(`/api/sites/${data.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      url?: string;
      error?: string;
    };
    setPublishing(false);
    if (res.ok && body.ok) {
      setNotice(`Published${body.url ? ` → ${body.url}` : ""}.`);
      router.refresh();
    } else setNotice(body.error ?? "Publish failed.");
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/sites" className="btn btn-ghost px-2 py-1.5 text-sm">
            ← Sites
          </Link>
          <div>
            <h1 className="font-display text-xl font-bold text-foreground">
              {data.name}
            </h1>
            <p className="text-xs text-muted">
              {data.kind === "landing" ? "Landing page" : "Website"}
              {data.status === "published" && data.publishedUrl && (
                <>
                  {" "}
                  ·{" "}
                  <a
                    href={data.publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {data.publishedUrl}
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <a
            href={`/api/sites/${data.id}/export?pageId=${currentId}`}
            className="btn btn-secondary text-xs"
          >
            <IconDownload className="h-3.5 w-3.5" /> Export
          </a>
          <button
            onClick={() => publish("in_app")}
            disabled={publishing}
            className="btn btn-primary text-xs"
          >
            <IconRocket className="h-3.5 w-3.5" />{" "}
            {publishing ? "Publishing…" : "Publish"}
          </button>
          <button
            onClick={() => publish("wordpress")}
            disabled={publishing}
            className="btn btn-secondary text-xs"
          >
            WordPress
          </button>
          <button
            onClick={() => publish("ftp")}
            disabled={publishing}
            className="btn btn-secondary text-xs"
          >
            FTP
          </button>
        </div>
      </div>
      {notice && <p className="mb-3 text-sm text-accent">{notice}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        {/* Chat */}
        <div className="card flex h-[60vh] min-w-0 flex-col p-0 lg:h-[calc(100vh-13rem)]">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <LogoMark size={24} />
            <span className="text-sm font-semibold text-foreground">
              Designer
            </span>
            <span className="ml-auto text-[11px] text-faint">Prism Mind</span>
          </div>
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 && (
              <p className="text-sm text-muted">
                Describe the page you want. e.g.{" "}
                <em>
                  &ldquo;A bold landing page for a match-day highlights video
                  package with a hero, showreel, packages, testimonials and a
                  book-a-call CTA.&rdquo;
                </em>
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-gradient-accent text-white" : "border border-border bg-surface/60 text-foreground"}`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                >
                  <IconSparkles className="h-4 w-4 text-accent" />
                </motion.span>
                Designing… this can take up to a minute.
              </div>
            )}
          </div>
          <div className="border-t border-border p-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              rows={3}
              placeholder="Describe or refine the page…  (⌘/Ctrl+Enter to send)"
              className="input resize-none"
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="btn btn-primary mt-2 w-full"
            >
              <IconSend className="h-4 w-4" /> {busy ? "Working…" : "Send"}
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="card flex h-[60vh] min-w-0 flex-col p-0 lg:h-[calc(100vh-13rem)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
              <button
                onClick={() => setView("preview")}
                className={`rounded-md px-2.5 py-1 ${view === "preview" ? "bg-gradient-accent text-white" : "text-muted"}`}
              >
                Preview
              </button>
              <button
                onClick={() => setView("code")}
                className={`rounded-md px-2.5 py-1 ${view === "code" ? "bg-gradient-accent text-white" : "text-muted"}`}
              >
                Code
              </button>
            </div>
            {view === "preview" && (
              <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
                <button
                  onClick={() => setDevice("desktop")}
                  className={`rounded-md px-2.5 py-1 ${device === "desktop" ? "bg-accent-soft text-accent" : "text-muted"}`}
                >
                  Desktop
                </button>
                <button
                  onClick={() => setDevice("mobile")}
                  className={`rounded-md px-2.5 py-1 ${device === "mobile" ? "bg-accent-soft text-accent" : "text-muted"}`}
                >
                  Mobile
                </button>
              </div>
            )}
            <select
              value={currentId}
              onChange={(e) => setCurrentId(e.target.value)}
              className="input w-auto py-1 text-xs"
            >
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.isHome ? "Home (/)" : p.path}
                </option>
              ))}
            </select>
            <button
              onClick={addPage}
              className="btn btn-ghost px-2 py-1 text-xs"
            >
              <IconArrowRight className="h-3.5 w-3.5" /> Add page
            </button>
          </div>

          <div className="flex-1 overflow-auto bg-black/30">
            {!page?.html ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">
                Describe your page in the chat and your AI designer will build it
                here — live.
              </div>
            ) : view === "code" ? (
              <pre className="h-full overflow-auto p-4 text-[11px] leading-relaxed text-muted">
                <code>{page.html}</code>
              </pre>
            ) : (
              <div
                className={`mx-auto h-full ${device === "mobile" ? "max-w-[390px] py-4" : "w-full"}`}
              >
                <iframe
                  title="preview"
                  srcDoc={page.html}
                  sandbox="allow-scripts allow-popups allow-forms"
                  className={`h-full w-full border-0 bg-white ${device === "mobile" ? "rounded-2xl shadow-lg" : ""}`}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
