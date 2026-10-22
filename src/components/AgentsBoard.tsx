"use client";

import { useEffect, useRef, useState } from "react";
import type { NamedAgent } from "@/lib/named-agents";
import { Reveal } from "@/components/ui/Reveal";

interface Source {
  uri: string;
  title: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  feedback?: "up" | "down";
  error?: boolean;
}

interface BoardState {
  chats: Record<string, ChatMessage[]>;
}

interface MemoryData {
  memory: string;
  learnings: string;
  lastDream: string | null;
}

interface DreamResult {
  agentId: string;
  skipped?: boolean;
  reason?: string;
  record?: { report: string; ideas: string[]; entryCount: number };
  error?: string;
}

function fmt(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "never";
}

export function AgentsBoard({ agents, intelAgents }: { agents: NamedAgent[]; intelAgents: string[] }) {
  const [state, setState] = useState<BoardState>({ chats: {} });
  const [activeId, setActiveId] = useState(agents[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [useSearch, setUseSearch] = useState(false);
  const [useIntel, setUseIntel] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dreaming, setDreaming] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [noting, setNoting] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [remembered, setRemembered] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const active = agents.find((a) => a.id === activeId) ?? agents[0];
  const messages = state.chats[active.id] ?? [];
  const hasIntel = intelAgents.includes(active.id);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.chats, busy, active.id]);

  function flash(tone: "ok" | "err", text: string) {
    setNotice({ tone, text });
    setTimeout(() => setNotice(null), 6000);
  }

  function switchAgent(id: string) {
    setActiveId(id);
    setUseIntel(true); // intel defaults on for agents that have a fresh brief
    setNoting(null);
    setNote("");
    composerRef.current?.focus();
  }

  function appendMessage(agentId: string, message: ChatMessage) {
    setState((s) => ({
      chats: { ...s.chats, [agentId]: [...(s.chats[agentId] ?? []), message] },
    }));
  }

  function patchMessage(agentId: string, index: number, patch: Partial<ChatMessage>) {
    setState((s) => ({
      chats: {
        ...s.chats,
        [agentId]: (s.chats[agentId] ?? []).map((m, i) => (i === index ? { ...m, ...patch } : m)),
      },
    }));
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const agentId = active.id;
    const history = [...(state.chats[agentId] ?? []), { role: "user" as const, content: text }];
    setInput("");
    setBusy(true);
    appendMessage(agentId, { role: "user", content: text });

    try {
      const res = await fetch(`/api/agents/${agentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
          useSearch,
          useIntel: hasIntel && useIntel,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        sources?: Source[];
        error?: string;
      };
      if (!res.ok || data.error || !data.text) {
        appendMessage(agentId, {
          role: "assistant",
          content: data.error ?? `Something went wrong (HTTP ${res.status}).`,
          error: true,
        });
      } else {
        appendMessage(agentId, {
          role: "assistant",
          content: data.text,
          sources: (data.sources ?? []).slice(0, 5),
        });
      }
    } catch (err) {
      appendMessage(agentId, {
        role: "assistant",
        content: err instanceof Error ? err.message : "The request failed — is the server running?",
        error: true,
      });
    }
    setBusy(false);
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  async function sendFeedback(index: number, rating: "up" | "down", feedbackNote = "") {
    const agentId = active.id;
    const msgs = state.chats[agentId] ?? [];
    const answer = msgs[index]?.content ?? "";
    const question = [...msgs.slice(0, index)].reverse().find((m) => m.role === "user")?.content ?? "";
    const res = await fetch(`/api/agents/${agentId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, note: feedbackNote, question, answer }),
    });
    if (res.ok) {
      patchMessage(agentId, index, { feedback: rating });
      setNoting(null);
      setNote("");
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      flash("err", body.error ?? "Feedback could not be saved.");
    }
  }

  async function rememberMessage(index: number) {
    const agentId = active.id;
    const content = (state.chats[agentId] ?? [])[index]?.content ?? "";
    const res = await fetch(`/api/agents/${agentId}/remember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: content }),
    });
    if (res.ok) {
      const key = `${agentId}:${index}`;
      setRemembered(key);
      setTimeout(() => setRemembered((r) => (r === key ? null : r)), 2000);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      flash("err", body.error ?? "Could not save to memory.");
    }
  }

  async function dreamNow() {
    setDreaming(true);
    try {
      const res = await fetch(`/api/dream/${active.id}`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { results?: DreamResult[]; error?: string };
      const r = data.results?.[0];
      if (!res.ok || data.error || !r) {
        flash("err", data.error ?? "The dream cycle failed.");
      } else if (r.error) {
        flash("err", `${active.name} could not dream — ${r.error}`);
      } else if (r.skipped) {
        flash("ok", `${active.name} has nothing new to dream about — ${r.reason ?? "no activity since the last dream."}`);
      } else {
        flash(
          "ok",
          `${active.name} dreamed on ${r.record?.entryCount ?? 0} journal entr${(r.record?.entryCount ?? 0) === 1 ? "y" : "ies"} — see the Dreams page.`
        );
      }
    } catch (err) {
      flash("err", err instanceof Error ? err.message : "The dream cycle failed.");
    }
    setDreaming(false);
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      {/* Left rail — the roster */}
      <aside className="flex shrink-0 gap-1.5 overflow-x-auto lg:w-60 lg:flex-col lg:overflow-visible">
        {agents.map((a, i) => {
          const isActive = a.id === active.id;
          return (
            <Reveal key={a.id} i={i}>
              <button
                onClick={() => switchAgent(a.id)}
                className={`card card-hover flex w-full items-center gap-3 px-3 py-2.5 text-left ${
                  isActive ? "border-accent shadow-glow" : ""
                }`}
              >
                <span className="text-xl">{a.emoji}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold" style={{ color: a.color }}>
                    {a.name}
                  </span>
                  <span className="block truncate text-xs text-muted">{a.title}</span>
                </span>
              </button>
            </Reveal>
          );
        })}
      </aside>

      {/* Chat workspace */}
      <div className="card flex min-h-[560px] flex-1 flex-col overflow-hidden">
        {/* Active-agent header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
          <span className="text-2xl">{active.emoji}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" style={{ color: active.color }}>
              {active.name}
            </p>
            <p className="truncate text-xs text-muted">{active.title}</p>
          </div>
          <button onClick={() => setMemoryOpen(true)} className="btn btn-secondary text-xs">
            🧠 Memory
          </button>
          <button onClick={dreamNow} disabled={dreaming} className="btn btn-secondary text-xs">
            {dreaming ? "☾ Dreaming…" : "☾ Dream now"}
          </button>
        </div>

        {notice && (
          <p
            className={`border-b border-border px-5 py-2 text-xs ${
              notice.tone === "err" ? "text-danger" : "text-accent"
            }`}
          >
            {notice.text}
          </p>
        )}

        {/* Message list */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {messages.length === 0 && !busy ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="text-4xl">{active.emoji}</span>
              <p className="max-w-md text-sm text-muted">
                Hello, I&apos;m <span className="font-semibold" style={{ color: active.color }}>{active.name}</span> —{" "}
                {active.tagline} What shall we work on?
              </p>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-accent px-4 py-2.5 text-sm text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="group flex justify-start">
                  <div
                    className={`max-w-[85%] rounded-2xl rounded-bl-md border px-4 py-2.5 ${
                      m.error ? "border-danger/50 bg-danger/5" : "border-border bg-surface/50"
                    }`}
                  >
                    <p className={`whitespace-pre-wrap text-sm ${m.error ? "text-danger" : "text-foreground"}`}>
                      {m.error ? `⚠ ${m.content}` : m.content}
                    </p>

                    {m.sources && m.sources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.sources.slice(0, 5).map((s, j) => (
                          <a
                            key={j}
                            href={s.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="badge border border-border bg-surface/50 text-faint hover:text-accent"
                            title={s.uri}
                          >
                            🔗 {s.title || s.uri}
                          </a>
                        ))}
                      </div>
                    )}

                    {!m.error && (
                      <div
                        className={`mt-2 flex items-center gap-1.5 transition-opacity ${
                          m.feedback || noting === i || remembered === `${active.id}:${i}`
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <button
                          onClick={() => !m.feedback && sendFeedback(i, "up")}
                          disabled={Boolean(m.feedback)}
                          title="Good answer — folded into learnings while dreaming"
                          className={`rounded-lg px-1.5 py-0.5 text-sm transition-colors ${
                            m.feedback === "up"
                              ? "bg-accent-soft"
                              : m.feedback
                                ? "opacity-30"
                                : "hover:bg-accent-soft"
                          }`}
                        >
                          👍
                        </button>
                        <button
                          onClick={() => {
                            if (m.feedback) return;
                            setNoting(noting === i ? null : i);
                            setNote("");
                          }}
                          disabled={Boolean(m.feedback)}
                          title="Poor answer — tell the agent why"
                          className={`rounded-lg px-1.5 py-0.5 text-sm transition-colors ${
                            m.feedback === "down"
                              ? "bg-danger/15"
                              : m.feedback
                                ? "opacity-30"
                                : "hover:bg-danger/10"
                          }`}
                        >
                          👎
                        </button>
                        <button
                          onClick={() => rememberMessage(i)}
                          title="Append this to the agent's MEMORY.md"
                          className="rounded-lg px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-accent-soft hover:text-foreground"
                        >
                          {remembered === `${active.id}:${i}` ? "✓ Saved to memory" : "📌 Remember"}
                        </button>
                      </div>
                    )}

                    {noting === i && !m.feedback && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          autoFocus
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && sendFeedback(i, "down", note.trim())}
                          placeholder="What was wrong? (optional)"
                          className="input flex-1 py-1.5 text-xs"
                        />
                        <button
                          onClick={() => sendFeedback(i, "down", note.trim())}
                          className="btn btn-secondary px-2.5 py-1.5 text-xs"
                        >
                          Send 👎
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            )
          )}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-border bg-surface/50 px-4 py-2.5 text-sm text-faint">
                {active.name} is thinking…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-border px-5 py-4">
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onComposerKey}
            rows={2}
            placeholder={`Brief ${active.name}… (Enter to send, Shift+Enter for a new line)`}
            className="input resize-none"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={useSearch}
                onChange={(e) => setUseSearch(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Live research
            </label>
            {hasIntel && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-xs text-muted"
                title="Bring this agent's fresh market brief into the conversation"
              >
                <input
                  type="checkbox"
                  checked={useIntel}
                  onChange={(e) => setUseIntel(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Platform intel
              </label>
            )}
            <button onClick={send} disabled={busy || !input.trim()} className="btn btn-primary ml-auto">
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>

      {memoryOpen && <MemoryModal agent={active} onClose={() => setMemoryOpen(false)} />}
    </div>
  );
}

function MemoryModal({ agent, onClose }: { agent: NamedAgent; onClose: () => void }) {
  const [data, setData] = useState<MemoryData | null>(null);
  const [memory, setMemory] = useState("");
  const [learnings, setLearnings] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/agents/${agent.id}/memory`);
      const body = (await res.json().catch(() => ({}))) as Partial<MemoryData> & { error?: string };
      if (cancelled) return;
      if (!res.ok || body.error) {
        setError(body.error ?? "Could not load memory.");
      } else {
        setData({ memory: body.memory ?? "", learnings: body.learnings ?? "", lastDream: body.lastDream ?? null });
        setMemory(body.memory ?? "");
        setLearnings(body.learnings ?? "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/agents/${agent.id}/memory`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory, learnings }),
    });
    setSaving(false);
    if (res.ok) {
      onClose();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Save failed.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-base font-semibold text-foreground">
          🧠 <span style={{ color: agent.color }}>{agent.name}</span>&apos;s memory
        </h2>
        <p className="mt-1 text-xs text-muted">
          Written by {agent.name} during dream cycles — edit freely; last dream: {fmt(data?.lastDream ?? null)}.
        </p>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {!data && !error ? (
          <div className="mt-4 space-y-3">
            <div className="skeleton h-40" />
            <div className="skeleton h-40" />
          </div>
        ) : (
          data && (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wide text-faint">MEMORY.md</span>
                <textarea
                  value={memory}
                  onChange={(e) => setMemory(e.target.value)}
                  rows={9}
                  spellCheck={false}
                  className="input mt-1 resize-y font-mono text-xs leading-relaxed"
                  placeholder="Nothing remembered yet."
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wide text-faint">LEARNINGS.md</span>
                <textarea
                  value={learnings}
                  onChange={(e) => setLearnings(e.target.value)}
                  rows={9}
                  spellCheck={false}
                  className="input mt-1 resize-y font-mono text-xs leading-relaxed"
                  placeholder="No self-taught rules yet."
                />
              </label>
            </div>
          )
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !data} className="btn btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
