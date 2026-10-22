"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MediaThumb, type MediaItem } from "@/components/MediaLibrary";

export interface PostItem {
  id: string;
  channel: string;
  format: string;
  title: string | null;
  status: string;
  body: string;
  hashtags: string | null;
  scheduledFor: string | null;
  errorMessage: string | null;
  postizPostId: string | null;
  media: MediaItem[];
}

const CHANNELS = [
  "instagram",
  "facebook",
  "tiktok",
  "linkedin",
  "youtube",
  "pinterest",
  "gbp",
];

const CHANNEL_LABELS: Record<string, string> = {
  gbp: "Google Business",
};

const CHANNEL_COLORS: Record<string, string> = {
  instagram: "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300",
  facebook: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  tiktok: "bg-foreground/15 text-foreground",
  linkedin: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  youtube: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  pinterest: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  gbp: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

const MAX_CHARS: Record<string, number> = {
  instagram: 2200,
  facebook: 5000,
  tiktok: 2200,
  linkedin: 3000,
  youtube: 5000,
  pinterest: 500,
  gbp: 1500,
};

// Kept in sync with FORMAT_OPTIONS in src/lib/posts.ts (client-safe copy —
// posts.ts pulls in server-only deps and can't be imported here). First = default.
const FORMAT_OPTIONS: Record<string, string[]> = {
  instagram: ["post", "reel", "carousel", "story"],
  facebook: ["post", "reel", "story"],
  tiktok: ["video"],
  linkedin: ["post", "carousel", "video"],
  youtube: ["short", "video"],
  pinterest: ["post", "video"],
  gbp: ["post"],
};

export function CalendarBoard({
  posts,
  media,
}: {
  posts: PostItem[];
  media: MediaItem[];
}) {
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [composing, setComposing] = useState<Partial<PostItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function moveMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  // Monday-first 6-week grid covering the visible month.
  const weeks = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const out: Date[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: Date[] = [];
      for (let d = 0; d < 7; d++) {
        row.push(
          new Date(
            start.getFullYear(),
            start.getMonth(),
            start.getDate() + w * 7 + d,
          ),
        );
      }
      out.push(row);
    }
    return out;
  }, [year, month]);

  const scheduled = posts.filter(
    (p) => p.scheduledFor && ["scheduled", "published"].includes(p.status),
  );
  const pending = posts.filter((p) => p.status === "pending_approval");
  const drafts = posts.filter((p) => ["draft", "rejected"].includes(p.status));
  const planned = posts.filter((p) => ["planned", "generating"].includes(p.status));
  const stuck = posts.filter(
    (p) => (p.status === "approved" && p.errorMessage) || p.status === "failed",
  );

  function postsOn(day: Date) {
    return scheduled.filter((p) => {
      const d = new Date(p.scheduledFor!);
      return (
        d.getFullYear() === day.getFullYear() &&
        d.getMonth() === day.getMonth() &&
        d.getDate() === day.getDate()
      );
    });
  }

  async function act(path: string, init: RequestInit, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setError(null);
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Request failed (HTTP ${res.status}).`);
    }
    router.refresh();
  }

  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      {posts.length === 0 && (
        <div className="mb-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted">
          <p className="font-medium text-foreground">Nothing on the calendar yet — it fills itself.</p>
          <p className="mt-1.5">
            Studio reels, templates, trend briefs and ad ideas all land here as drafts. Approve one and
            Prism publishes it to the right channel at the right time. Or compose a post directly: pick a
            day below.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => moveMonth(-1)}
            className="rounded-lg border border-border-strong px-2.5 py-1 text-sm "
          >
            ←
          </button>
          <span className="w-40 text-center text-sm font-medium">
            {monthLabel}
          </span>
          <button
            onClick={() => moveMonth(1)}
            className="rounded-lg border border-border-strong px-2.5 py-1 text-sm "
          >
            →
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              act("/api/posts/plan-week", { method: "POST" }, "Plan a week of posts? The team sketches 5-7 angles across your channels; each one's copy writes itself about two days before its slot, then waits for your approval.")
            }
            className="rounded-lg border border-border-strong px-4 py-2 text-sm font-medium hover:border-accent"
          >
            ✨ Plan my week
          </button>
          <button
            onClick={() => setComposing({})}
            className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110"
          >
            New post
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-border"><div className="grid min-w-[640px] grid-cols-7 gap-px bg-border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="bg-foreground/5 px-2 py-1.5 text-xs font-medium text-muted "
          >
            {d}
          </div>
        ))}
        {weeks.flat().map((day, i) => {
          const isToday = day.toDateString() === today.toDateString();
          const inMonth = day.getMonth() === month;
          return (
            <div
              key={i}
              className={`min-h-20 bg-card p-1.5 ${inMonth ? "" : "opacity-40"}`}
            >
              <span
                className={`text-xs ${isToday ? "rounded-full bg-gradient-accent px-1.5 py-0.5 text-white" : "text-muted"}`}
              >
                {day.getDate()}
              </span>
              <div className="mt-1 space-y-1">
                {postsOn(day).map((p) => (
                  <div
                    key={p.id}
                    className={`truncate rounded px-1 py-0.5 text-[10px] ${CHANNEL_COLORS[p.channel] ?? ""}`}
                    title={p.body}
                  >
                    {new Date(p.scheduledFor!).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    {p.channel}
                    {p.status === "published" ? " ✓" : ""}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      </div>

      {pending.length > 0 && (
        <Section title={`Awaiting your approval (${pending.length})`}>
          <a href="/review" className="mb-1 inline-block rounded-lg bg-gradient-accent px-3 py-1.5 text-xs font-medium text-white">
            ⚡ Triage all in Review — A to approve, D to skip
          </a>
          {pending.map((p) => (
            <PostRow key={p.id} post={p}>
              <button
                onClick={() =>
                  act(`/api/posts/${p.id}/decision`, {
                    method: "POST",
                    body: JSON.stringify({ decision: "approve" }),
                  })
                }
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                Approve & schedule
              </button>
              <button
                onClick={() =>
                  act(`/api/posts/${p.id}/decision`, {
                    method: "POST",
                    body: JSON.stringify({ decision: "reject" }),
                  })
                }
                className="rounded-lg border border-border-strong px-3 py-1.5 text-xs "
              >
                Reject
              </button>
            </PostRow>
          ))}
        </Section>
      )}

      {stuck.length > 0 && (
        <Section title={`Approved but not scheduled (${stuck.length})`}>
          {stuck.map((p) => (
            <PostRow key={p.id} post={p}>
              <button
                onClick={() =>
                  act(`/api/posts/${p.id}/decision`, {
                    method: "POST",
                    body: JSON.stringify({ decision: "approve" }),
                  })
                }
                className="rounded-lg bg-gradient-accent px-3 py-1.5 text-xs font-medium text-white"
              >
                Retry scheduling
              </button>
              <button
                onClick={() =>
                  act(
                    `/api/posts/${p.id}`,
                    { method: "DELETE" },
                    "Delete this post?",
                  )
                }
                className="rounded-lg border border-border-strong px-3 py-1.5 text-xs text-red-500 "
              >
                Delete
              </button>
            </PostRow>
          ))}
        </Section>
      )}

      {planned.length > 0 && (
        <Section title={`Planned — writing itself (${planned.length})`}>
          {planned.map((p) => {
            const genDate = p.scheduledFor ? new Date(new Date(p.scheduledFor).getTime() - 2 * 24 * 60 * 60 * 1000) : null;
            const genLabel =
              p.status === "generating"
                ? "Writing now…"
                : genDate && genDate.getTime() > today.getTime()
                  ? `Generating on ${genDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                  : "Generating shortly";
            return (
              <PostRow key={p.id} post={p}>
                <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
                  ✨ {genLabel}
                </span>
                <button
                  onClick={() => act(`/api/posts/${p.id}`, { method: "DELETE" }, "Drop this planned post?")}
                  className="rounded-lg border border-border-strong px-3 py-1.5 text-xs text-red-400"
                >
                  Drop
                </button>
              </PostRow>
            );
          })}
        </Section>
      )}

      {drafts.length > 0 && (
        <Section title={`Drafts (${drafts.length})`}>
          {drafts.map((p) => (
            <PostRow key={p.id} post={p}>
              <button
                onClick={() =>
                  act(`/api/posts/${p.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ action: "submit" }),
                  })
                }
                className="rounded-lg bg-gradient-accent px-3 py-1.5 text-xs font-medium text-white"
              >
                Submit for approval
              </button>
              <button
                onClick={() => setComposing(p)}
                className="rounded-lg border border-border-strong px-3 py-1.5 text-xs "
              >
                Edit
              </button>
              <button
                onClick={() =>
                  act(
                    `/api/posts/${p.id}`,
                    { method: "DELETE" },
                    "Delete this draft?",
                  )
                }
                className="rounded-lg border border-border-strong px-3 py-1.5 text-xs text-red-500 "
              >
                Delete
              </button>
            </PostRow>
          ))}
        </Section>
      )}

      {composing && (
        <Composer
          media={media}
          initial={composing}
          onClose={() => setComposing(null)}
          onSaved={() => {
            setComposing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function PostRow({
  post,
  children,
}: {
  post: PostItem;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border p-4 ">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${CHANNEL_COLORS[post.channel] ?? ""}`}
            >
              {post.channel}
            </span>
            {post.format && post.format !== "post" && (
              <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-xs text-muted">
                {post.format}
              </span>
            )}
            {post.scheduledFor && (
              <span className="text-xs text-muted">
                {new Date(post.scheduledFor).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            )}
            {post.media.length > 0 && (
              <span className="text-xs text-muted">
                {post.media.length} media
              </span>
            )}
            {post.status === "rejected" && (
              <span className="text-xs text-red-500">
                rejected — edit and resubmit
              </span>
            )}
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm">{post.body}</p>
          {post.hashtags && (
            <p className="mt-0.5 truncate text-xs text-muted">
              {post.hashtags}
            </p>
          )}
          {post.errorMessage && (
            <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-500">
              {post.errorMessage}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
          {children}
        </div>
      </div>
    </div>
  );
}

function Composer({
  media,
  initial,
  onClose,
  onSaved,
}: {
  media: MediaItem[];
  initial: Partial<PostItem>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editingId = initial.id ?? null;
  const [channel, setChannel] = useState(initial.channel ?? "instagram");
  const [format, setFormat] = useState(
    initial.format ??
      FORMAT_OPTIONS[initial.channel ?? "instagram"]?.[0] ??
      "post",
  );
  const [title, setTitle] = useState(initial.title ?? "");
  const [body, setBody] = useState(initial.body ?? "");
  const [hashtags, setHashtags] = useState(initial.hashtags ?? "");
  const [when, setWhen] = useState(
    initial.scheduledFor ? toLocalInput(initial.scheduledFor) : "",
  );
  const [mediaIds, setMediaIds] = useState<string[]>(
    initial.media?.map((m) => m.id) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxChars = MAX_CHARS[channel] ?? 2200;
  const formatOptions = FORMAT_OPTIONS[channel] ?? ["post"];

  // AI: rewrite caption + hashtags optimised for the chosen channel & format.
  async function optimize() {
    if (!body.trim()) {
      setError("Write a caption first, then optimise it.");
      return;
    }
    setOptimizing(true);
    setError(null);
    const res = await fetch("/api/posts/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, hashtags, channel, format }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      caption?: string;
      hashtags?: string;
      error?: string;
    };
    setOptimizing(false);
    if (res.ok && data.caption !== undefined) {
      setBody(data.caption);
      setHashtags(data.hashtags ?? "");
    } else {
      setError(data.error ?? "Could not optimise the copy.");
    }
  }

  // Switching channel: keep the format if the new channel supports it, else default.
  function changeChannel(next: string) {
    setChannel(next);
    const opts = FORMAT_OPTIONS[next] ?? ["post"];
    if (!opts.includes(format)) setFormat(opts[0]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const payload = {
      channel,
      format,
      title:
        channel === "youtube" || channel === "pinterest" ? title : undefined,
      body,
      hashtags,
      scheduledFor: when ? new Date(when).toISOString() : undefined,
      mediaIds,
    };
    const res = await fetch(
      editingId ? `/api/posts/${editingId}` : "/api/posts",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    setBusy(false);
    if (res.ok) onSaved();
    else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Save failed.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-medium">{editingId ? "Edit draft" : "New post"}</h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Channel</span>
            <select
              value={channel}
              onChange={(e) => changeChannel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm  "
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c] ?? c}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium">Format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm  "
            >
              {formatOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </div>

        {(channel === "youtube" || channel === "pinterest") && (
          <label className="mt-3 block text-sm">
            <span className="font-medium">
              {channel === "pinterest" ? "Pin title" : "Title"}
            </span>
            <span className="ml-2 text-xs text-muted">
              {channel === "pinterest"
                ? "recommended for Pinterest"
                : "required for YouTube"}
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Project reveal — your brand"
              className="mt-1 w-full rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm "
            />
          </label>
        )}

        <label className="mt-3 block text-sm">
          <span className="font-medium">
            {channel === "youtube" ? "Description" : "Caption"}
          </span>
          <span
            className={`ml-2 text-xs ${body.length > maxChars ? "text-red-500" : "text-muted"}`}
          >
            {body.length}/{maxChars}
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm "
          />
        </label>

        <label className="mt-3 block text-sm">
          <span className="font-medium">Hashtags</span>
          <input
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#yourbrand #yourniche"
            className="mt-1 w-full rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm "
          />
        </label>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={optimize}
            disabled={optimizing || !body.trim()}
            className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
            title="Rewrite the caption & hashtags optimised for this channel using current guidelines & trends"
          >
            {optimizing ? "Optimising…" : `✨ Optimise for ${channel}`}
          </button>
          <span className="text-xs text-muted">
            AI tunes tone, length & tags to the channel.
          </span>
        </div>

        <label className="mt-3 block text-sm">
          <span className="font-medium">Schedule for</span>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm dark:[color-scheme:dark]"
          />
        </label>

        <div className="mt-3 text-sm">
          <span className="font-medium">Media</span>
          <span className="ml-2 text-xs text-muted">
            {channel === "tiktok"
              ? "TikTok needs one video"
              : channel === "instagram"
                ? "Instagram needs at least one item"
                : "optional"}
          </span>
          {media.length === 0 ? (
            <p className="mt-1 text-xs text-muted">
              Library is empty — add files on the Media page first.
            </p>
          ) : (
            <div className="mt-2 grid max-h-44 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {media.map((m) => {
                const selected = mediaIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setMediaIds(
                        selected
                          ? mediaIds.filter((id) => id !== m.id)
                          : [...mediaIds, m.id],
                      )
                    }
                    className={`relative h-20 overflow-hidden rounded-lg border-2 ${selected ? "border-emerald-500" : "border-transparent"}`}
                    title={m.originalName}
                  >
                    <MediaThumb
                      item={m}
                      className="h-full w-full object-cover"
                    />
                    {selected && (
                      <span className="absolute right-1 top-1 rounded-full bg-emerald-500 px-1.5 text-xs text-white">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border-strong px-4 py-2 text-sm "
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !body.trim()}
            className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
