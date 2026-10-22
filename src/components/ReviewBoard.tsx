"use client";

// Review Mode (P4.1): every post the AI team has made, shown as an EXACT
// replica of how the platform will show it on a phone. Filter by stage;
// posts awaiting approval keep the pro triage — ←/→ move, A approve,
// D skip — drafts can be sent for approval, the rest browse read-only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNow } from "@/lib/hooks/useNow";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { PostReplica, type BrandIdentity } from "@/components/PostReplica";

export interface ReviewPost {
  id: string;
  channel: string;
  format: string;
  status: string;
  title: string | null;
  body: string;
  hashtags: string | null;
  scheduledFor: string | null;
  media: { id: string; mimeType: string }[];
  refractionGroup: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface Entry {
  key: string;
  posts: ReviewPost[];
}

function toEntries(posts: ReviewPost[]): Entry[] {
  const entries: Entry[] = [];
  const byGroup = new Map<string, Entry>();
  for (const p of posts) {
    if (!p.refractionGroup) {
      entries.push({ key: p.id, posts: [p] });
      continue;
    }
    const e = byGroup.get(p.refractionGroup);
    if (e) e.posts.push(p);
    else {
      const fresh = { key: p.refractionGroup, posts: [p] };
      byGroup.set(p.refractionGroup, fresh);
      entries.push(fresh);
    }
  }
  return entries;
}

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  pinterest: "Pinterest",
  gbp: "Google Business",
};

const FILTERS: { key: string; label: string; statuses: string[] }[] = [
  { key: "pending", label: "Awaiting your yes", statuses: ["pending_approval"] },
  { key: "drafts", label: "Drafts", statuses: ["draft", "generating"] },
  { key: "upcoming", label: "Being written", statuses: ["planned"] },
  { key: "scheduled", label: "Approved & scheduled", statuses: ["approved", "scheduled"] },
  { key: "published", label: "Published", statuses: ["published"] },
  { key: "all", label: "Everything", statuses: [] },
];

const STATUS_NOTE: Record<string, string> = {
  planned: "Planned — the copy and visual are written closer to its slot.",
  generating: "Being written right now.",
  draft: "Draft — send it for approval when it looks right.",
  approved: "Approved — publishing at its scheduled time.",
  scheduled: "Scheduled with the platform — going live automatically.",
  published: "Published — live on the platform.",
  failed: "Publishing failed — check the calendar for details.",
  rejected: "Skipped — kept in the calendar, never posted.",
};

export function ReviewBoard({ initial, brand }: { initial: ReviewPost[]; brand: BrandIdentity }) {
  const router = useRouter();
  const [all, setAll] = useState<ReviewPost[]>(initial);
  const pendingCount = all.filter((p) => p.status === "pending_approval").length;
  const [filter, setFilter] = useState<string>(pendingCount > 0 ? "pending" : "all");
  const [i, setI] = useState(0);
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ghost, setGhost] = useState(false);
  const touchX = useRef<number | null>(null);
  const [decided, setDecided] = useState(0);

  const active = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[5];
    const posts = f.statuses.length ? all.filter((p) => f.statuses.includes(p.status)) : all;
    return toEntries(posts);
  }, [all, filter]);
  const entry = active[Math.min(i, Math.max(active.length - 1, 0))] ?? null;
  const post = entry?.posts[Math.min(tab, (entry?.posts.length ?? 1) - 1)] ?? null;
  const isPending = post?.status === "pending_approval";
  const isDraft = post?.status === "draft";

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) {
      c[f.key] = f.statuses.length ? all.filter((p) => f.statuses.includes(p.status)).length : all.length;
    }
    return c;
  }, [all]);

  const now = useNow();
  const overnight =
    now == null
      ? 0
      : all.filter(
          (p) => p.status === "pending_approval" && p.createdBy === "agent" && now - new Date(p.createdAt).getTime() < 16 * 60 * 60 * 1000
        ).length;

  const move = useCallback(
    (d: number) => {
      setTab(0);
      setGhost(false);
      setI((cur) => Math.min(Math.max(cur + d, 0), Math.max(active.length - 1, 0)));
    },
    [active.length]
  );

  const decide = useCallback(
    async (decision: "approve" | "reject") => {
      if (!entry || busy || entry.posts.some((p) => p.status !== "pending_approval")) return;
      setBusy(true);
      setError(null);
      for (const p of entry.posts) {
        const res = await fetch(`/api/posts/${p.id}/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          setBusy(false);
          setError(`${p.channel}: ${b.error ?? `decision failed (HTTP ${res.status})`}`);
          return;
        }
      }
      setBusy(false);
      setDecided((n) => n + entry.posts.length);
      setFlash(decision === "approve" ? `Approved ✓${entry.posts.length > 1 ? ` — all ${entry.posts.length} cuts` : ""}` : "Skipped");
      setTimeout(() => setFlash(null), 900);
      const ids = new Set(entry.posts.map((p) => p.id));
      setAll((q) => q.map((p) => (ids.has(p.id) ? { ...p, status: decision === "approve" ? "approved" : "rejected" } : p)));
      setTab(0);
    },
    [entry, busy]
  );

  const sendForApproval = useCallback(async () => {
    if (!post || busy || post.status !== "draft") return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit" }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "Couldn't submit that draft.");
      return;
    }
    setFlash("Sent for approval ✓");
    setTimeout(() => setFlash(null), 900);
    setAll((q) => q.map((p) => (p.id === post.id ? { ...p, status: "pending_approval" } : p)));
  }, [post, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else if ((e.key === "a" || e.key === "A") && isPending) void decide("approve");
      else if ((e.key === "d" || e.key === "D") && isPending) void decide("reject");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, decide, isPending]);

  const approveAll = async () => {
    const pending = all.filter((p) => p.status === "pending_approval");
    if (!pending.length || busy) return;
    if (!confirm(`Approve all ${pending.length} waiting posts? They'll publish to their channels on schedule.`)) return;
    setBusy(true);
    for (const p of pending) {
      await fetch(`/api/posts/${p.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve" }),
      }).catch(() => {});
    }
    setBusy(false);
    setAll((q) => q.map((p) => (p.status === "pending_approval" ? { ...p, status: "approved" } : p)));
    router.refresh();
  };

  const quickEdit = async (instruction?: string) => {
    if (!post || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/posts/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: post.channel,
        format: post.format,
        body: post.body,
        hashtags: post.hashtags ?? "",
        instruction,
      }),
    });
    const b = (await res.json().catch(() => ({}))) as { caption?: string; hashtags?: string; error?: string };
    if (!res.ok || !b.caption) {
      setBusy(false);
      setError(b.error ?? "Rewrite failed.");
      return;
    }
    const patch = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: b.caption, hashtags: b.hashtags ?? "" }),
    });
    setBusy(false);
    if (!patch.ok) {
      setError("The rewrite couldn't be saved.");
      return;
    }
    setAll((q) => q.map((p) => (p.id === post!.id ? { ...p, body: b.caption!, hashtags: b.hashtags ?? "" } : p)));
    setNote("");
  };

  const isGroup = (entry?.posts.length ?? 0) > 1;

  return (
    <div
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 60) move(dx < 0 ? 1 : -1);
      }}
    >
      {/* Stage filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setFilter(f.key);
              setI(0);
              setTab(0);
            }}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === f.key ? "border-accent bg-accent-soft text-foreground" : "border-border text-muted hover:text-foreground"
            }`}
          >
            {f.label} <span className="opacity-60">{counts[f.key]}</span>
          </button>
        ))}
        {pendingCount > 0 && (
          <button onClick={approveAll} disabled={busy} className="btn btn-secondary ml-auto text-xs">
            Approve all waiting ({pendingCount})
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {flash && <p className="mt-3 text-sm font-semibold text-success">{flash}</p>}
      {overnight > 0 && filter === "pending" && (
        <p className="mt-2 text-sm text-muted">🌙 {overnight} of these arrived overnight — made while you slept.</p>
      )}

      {!post ? (
        <div className="mt-6">
          <EmptyState image="/empty/clear.webp" title={filter === "pending" ? "Queue clear. Nothing waits on you. 🎉" : "Nothing at this stage right now."}>
            {decided > 0
              ? `You triaged ${decided} post${decided === 1 ? "" : "s"} this sitting.`
              : "New posts land here as your AI team writes them."}
          </EmptyState>
        </div>
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="relative">
            <p className="mb-3 text-center text-sm text-muted">
              <span className="font-semibold text-foreground">{active.length ? Math.min(i, active.length - 1) + 1 : 0} of {active.length}</span>
              {" · "}
              {CHANNEL_LABEL[post.channel] ?? post.channel} {post.format}
              {post.scheduledFor && <> · {new Date(post.scheduledFor).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</>}
            </p>
            {isGroup && entry && (
              <div className="mx-auto mb-3 flex max-w-sm flex-wrap items-center justify-center gap-1.5">
                {entry.posts.map((p, ti) => (
                  <button
                    key={p.id}
                    onClick={() => setTab(ti)}
                    className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                      ti === Math.min(tab, entry.posts.length - 1)
                        ? "border-accent bg-accent-soft text-foreground"
                        : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {CHANNEL_LABEL[p.channel] ?? p.channel}
                  </button>
                ))}
                <button onClick={() => setGhost((g) => !g)} className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-faint hover:text-foreground">
                  {ghost ? "hide" : "vs cross-posting"}
                </button>
              </div>
            )}
            {ghost && isGroup && entry && (
              <div className="mx-auto mb-3 max-w-sm rounded-xl border border-dashed border-border p-3 opacity-70">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">What cross-posting would have sent — the same words, everywhere</p>
                <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-xs text-muted">{entry.posts[0].body}</p>
              </div>
            )}

            <PostReplica post={post} brand={brand} />

            {!isPending && (
              <p className="mx-auto mt-3 max-w-sm text-center text-xs text-faint">{STATUS_NOTE[post.status] ?? post.status}</p>
            )}
            {isGroup && (
              <p className="mx-auto mt-2 max-w-sm text-center text-[11px] text-faint">
                One idea, {entry!.posts.length} native cuts — approving takes all of them.
              </p>
            )}
            <div className="mx-auto mt-4 flex max-w-sm flex-wrap items-center justify-center gap-2">
              <button onClick={() => move(-1)} disabled={i === 0} className="btn btn-secondary text-sm disabled:opacity-40">← Prev</button>
              {isPending && (
                <>
                  <button onClick={() => decide("reject")} disabled={busy} className="btn btn-secondary text-sm !text-danger">✕ Don&rsquo;t post</button>
                  <button onClick={() => decide("approve")} disabled={busy} className="btn btn-primary text-sm">✓ Approve</button>
                </>
              )}
              {isDraft && (
                <button onClick={sendForApproval} disabled={busy} className="btn btn-primary text-sm">Send for approval →</button>
              )}
              <button onClick={() => move(1)} disabled={i >= active.length - 1} className="btn btn-secondary text-sm disabled:opacity-40">Next →</button>
            </div>
            {isPending && (
              <div className="mx-auto mt-3 hidden max-w-sm items-center justify-center gap-3 text-[11px] text-faint md:flex">
                <span><kbd className="rounded border border-border px-1">←</kbd> <kbd className="rounded border border-border px-1">→</kbd> move</span>
                <span><kbd className="rounded border border-border px-1">A</kbd> approve</span>
                <span><kbd className="rounded border border-border px-1">D</kbd> don&rsquo;t post</span>
              </div>
            )}
          </div>

          {/* Quick edits rail */}
          <div className="space-y-3">
            <div className="card p-4">
              <p className="text-sm font-medium text-foreground">Quick edits</p>
              <button onClick={() => quickEdit()} disabled={busy} className="btn btn-secondary mt-3 w-full text-xs">
                {busy ? "Working…" : `✨ Optimise for ${CHANNEL_LABEL[post.channel] ?? post.channel}`}
              </button>
              <div className="mt-3">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && note.trim() && quickEdit(note.trim())}
                  placeholder="Tell it what to change — 'make it punchier'"
                  className="input w-full text-xs"
                />
                <button onClick={() => note.trim() && quickEdit(note.trim())} disabled={busy || !note.trim()} className="btn btn-secondary mt-2 w-full text-xs">
                  Apply my note
                </button>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-faint">
              {isPending
                ? `Approving publishes to ${CHANNEL_LABEL[post.channel] ?? post.channel} through your own account${post.scheduledFor ? " at the scheduled time" : ""}. "Don't post" keeps it in the calendar as skipped — nothing is deleted.`
                : "This is exactly how the post will look on the platform. Nothing publishes without your approval."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
