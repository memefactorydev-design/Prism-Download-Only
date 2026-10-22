"use client";

// Iris — Prism's AI guide. Replaces the static help drawer with a chat that
// knows the member's brand, the whole product, and can raise support tickets.
// The old route-aware tips stay as (a) starter chips and (b) the honest
// fallback when Iris is unavailable. Same shell as before: floating button,
// slide-in drawer, Topbar "scc:help" event, Esc to close.

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { helpFor } from "@/lib/help";
import { IconX, IconSparkles, IconArrowRight } from "@/components/ui/icons";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}
interface Ticket {
  id: string;
  reference: string;
  subject: string;
  status: string;
  resolution: string | null;
}

export function HelpLauncher() {
  const pathname = usePathname();
  const entry = helpFor(pathname);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [justRaised, setJustRaised] = useState<{ reference: string; subject: string } | null>(null);
  const [teaser, setTeaser] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A small "I'm a chatbot" nudge next to the launcher: pops in after a beat,
  // goes away for good once dismissed (or once the chat has been opened).
  useEffect(() => {
    if (localStorage.getItem("iris:teaser-dismissed")) return;
    const t = setTimeout(() => setTeaser(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const dismissTeaser = () => {
    setTeaser(false);
    localStorage.setItem("iris:teaser-dismissed", "1");
  };

  useEffect(() => {
    const openHandler = () => setOpen(true);
    const keyHandler = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("scc:help", openHandler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("scc:help", openHandler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, []);

  // Hydrate the thread + tickets on first open.
  useEffect(() => {
    if (!open || hydrated) return;
    setHydrated(true);
    fetch("/api/iris/history")
      .then((r) => r.json())
      .then((j: { messages?: ChatMsg[]; tickets?: Ticket[] }) => {
        setMessages(j.messages ?? []);
        setTickets(j.tickets ?? []);
      })
      .catch(() => {});
  }, [open, hydrated]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || busy) return;
      setInput("");
      setBusy(true);
      setToolNote(null);
      setJustRaised(null);
      setMessages((m) => [...m, { role: "user", content: msg }, { role: "assistant", content: "" }]);
      try {
        const res = await fetch("/api/iris/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg, pathname }),
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const setLast = (content: string) =>
          setMessages((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, content } : x)));
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const frame = JSON.parse(line) as {
              type: string;
              text?: string;
              name?: string;
              error?: string;
              fallback?: boolean;
              ticket?: { id: string; subject: string } | null;
            };
            if (frame.type === "delta" && frame.text) setLast(frame.text);
            if (frame.type === "tool" && frame.name === "raise_ticket") setToolNote("Raising a ticket…");
            if (frame.type === "done") {
              setLast(frame.text ?? "");
              if (frame.ticket) {
                setJustRaised({ reference: `#${frame.ticket.id.slice(-6)}`, subject: frame.ticket.subject });
                fetch("/api/iris/history")
                  .then((r) => r.json())
                  .then((j: { tickets?: Ticket[] }) => setTickets(j.tickets ?? []))
                  .catch(() => {});
              }
            }
            if (frame.type === "error") {
              if (frame.fallback) setFallback(true);
              setLast(frame.error ?? "Something went wrong.");
            }
          }
        }
      } catch (err) {
        setMessages((m) =>
          m.map((x, i) =>
            i === m.length - 1 ? { ...x, content: err instanceof Error ? err.message : "Something went wrong." } : x
          )
        );
      } finally {
        setBusy(false);
        setToolNote(null);
      }
    },
    [busy, pathname]
  );

  const chips = [
    `What can I do on this page?`,
    ...entry.tips.slice(0, 1).map(() => `Walk me through ${entry.title.split("—")[0].trim()}`),
    "Something isn't working",
  ];

  return (
    <>
      <AnimatePresence>
        {teaser && !open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            className="fixed bottom-6 right-20 z-40 flex max-w-[240px] items-start gap-2 rounded-2xl rounded-br-sm border border-border bg-card px-3.5 py-2.5 shadow-lg"
          >
            <button
              onClick={() => {
                dismissTeaser();
                setOpen(true);
              }}
              className="text-left text-xs leading-relaxed text-foreground"
            >
              Hi — I&rsquo;m <span className="font-semibold">Iris</span>, your Prism guide. Chat to me about
              anything ✨
            </button>
            <button
              onClick={dismissTeaser}
              aria-label="Dismiss"
              className="mt-0.5 shrink-0 text-faint transition-colors hover:text-foreground"
            >
              <IconX className="h-3 w-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => {
          dismissTeaser();
          setOpen(true);
        }}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full shadow-glow ring-1 ring-white/15"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Chat with Iris — help & next steps"
      >
        <Image src="/iris.png" alt="Iris" width={48} height={48} className="h-full w-full object-cover" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-lg"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="h-9 w-9 overflow-hidden rounded-full ring-1 ring-white/15">
                    <Image src="/iris.png" alt="" width={36} height={36} className="h-full w-full object-cover" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Iris</p>
                    <p className="text-[11px] text-faint">Your Prism guide — ask me anything</p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="btn btn-ghost px-2 py-2" aria-label="Close">
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {fallback ? (
                  <FallbackTips pathname={pathname} onClose={() => setOpen(false)} />
                ) : (
                  <>
                    {messages.length === 0 && (
                      <div className="rounded-xl border border-border bg-surface/60 p-4 text-sm text-muted">
                        <p className="text-foreground">
                          Hi — I&rsquo;m Iris. I know this whole place and I know your brand. Ask me how anything
                          works, what to do next, or tell me what&rsquo;s gone wrong.
                        </p>
                        <p className="mt-2 text-xs text-faint">You&rsquo;re on: {entry.title}</p>
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                            m.role === "user"
                              ? "bg-accent-soft text-foreground"
                              : "border border-border bg-surface/60 text-foreground"
                          }`}
                        >
                          {m.content ||
                            (busy && i === messages.length - 1 ? (
                              <span className="inline-flex gap-1">
                                <Dot d={0} />
                                <Dot d={0.15} />
                                <Dot d={0.3} />
                              </span>
                            ) : (
                              "…"
                            ))}
                        </div>
                      </div>
                    ))}
                    {toolNote && <p className="text-center text-xs text-faint">{toolNote}</p>}
                    {justRaised && (
                      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                        <p className="font-medium text-foreground">Ticket {justRaised.reference} raised</p>
                        <p className="mt-0.5 text-xs text-muted">
                          &ldquo;{justRaised.subject}&rdquo; — the Prism team will pick this up. You&rsquo;ll see the
                          outcome right here.
                        </p>
                      </div>
                    )}
                    {tickets.length > 0 && (
                      <div className="rounded-xl border border-border bg-surface/40 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-faint">Your tickets</p>
                        <ul className="mt-1.5 space-y-1">
                          {tickets.slice(0, 4).map((t) => (
                            <li key={t.id} className="text-xs text-muted">
                              <span className={t.status === "open" ? "text-amber-400" : "text-emerald-400"}>
                                {t.status === "open" ? "●" : "✓"}
                              </span>{" "}
                              {t.reference} {t.subject}
                              {t.resolution ? <span className="text-faint"> — {t.resolution}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {messages.length === 0 && (
                      <div className="flex flex-wrap gap-2">
                        {chips.map((c) => (
                          <button
                            key={c}
                            onClick={() => send(c)}
                            className="rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs text-muted transition hover:border-border-strong hover:text-foreground"
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {!fallback && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                  }}
                  className="border-t border-border p-3"
                >
                  <div className="flex gap-2">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Ask Iris anything…"
                      className="input flex-1"
                      maxLength={4000}
                    />
                    <button type="submit" disabled={busy || !input.trim()} className="btn btn-primary px-3">
                      <IconArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-1.5 text-center text-[10px] text-faint">
                    Iris is AI — she&rsquo;ll raise a ticket to the team for anything she can&rsquo;t fix.
                  </p>
                </form>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function Dot({ d }: { d: number }) {
  return (
    <motion.span
      className="h-1.5 w-1.5 rounded-full bg-accent"
      animate={{ opacity: [0.3, 1, 0.3] }}
      transition={{ repeat: Infinity, duration: 1, delay: d }}
    />
  );
}

// The old static help content — the honest fallback when Iris can't wake up.
function FallbackTips({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const entry = helpFor(pathname);
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-muted">
        Iris is unavailable right now — here are the essentials for this page instead.
      </div>
      <div>
        <h3 className="font-display text-lg font-semibold text-foreground">{entry.title}</h3>
        <p className="mt-1 text-sm text-muted">{entry.blurb}</p>
      </div>
      <ul className="space-y-2">
        {entry.tips.map((t, i) => (
          <li key={i} className="flex gap-2.5 rounded-xl border border-border bg-surface/60 p-3 text-sm text-foreground">
            <span className="mt-0.5 text-accent">
              <IconSparkles className="h-4 w-4" />
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        {entry.nextSteps.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            onClick={onClose}
            className="card-hover group flex items-center justify-between rounded-xl border border-border p-3 text-sm font-medium text-foreground"
          >
            {s.label}
            <IconArrowRight className="h-4 w-4 text-accent transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}
