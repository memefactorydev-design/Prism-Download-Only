"use client";

// Pixel-faithful mobile previews: each channel rendered the way the REAL app
// shows a post on a phone — light chrome, native action rows, right-rail for
// vertical video — so approving in Review feels like seeing the post live.
// All chrome is inline SVG/CSS: no external assets, crisp at any size.

import { useRef, useState } from "react";

export interface ReplicaPost {
  channel: string;
  format: string;
  title: string | null;
  body: string;
  hashtags: string | null;
  media: { id: string; mimeType: string }[];
}

export interface BrandIdentity {
  name: string; // "Jordan Andrews"
  handle: string; // "jordanandrews"
}

const mediaUrl = (m: { id: string }) => `/api/media/${m.id}/file`;

function Avatar({ brand, size = 32, ring = false }: { brand: BrandIdentity; size?: number; ring?: boolean }) {
  const initials = brand.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${
        ring ? "ring-2 ring-offset-2 ring-offset-white" : ""
      }`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: "linear-gradient(135deg,#6D5AF7,#FF4E8E)",
        ...(ring ? { boxShadow: "0 0 0 2px #fff, 0 0 0 4px #FF4E8E" } : {}),
      }}
    >
      {initials}
    </span>
  );
}

function Media({
  post,
  className,
  videoRef,
  controls = true,
  onPauseState,
}: {
  post: ReplicaPost;
  className: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** Native controls — off for the vertical replica, which draws its own play badge. */
  controls?: boolean;
  onPauseState?: (paused: boolean) => void;
}) {
  // Prefer the video when a post carries both (backfilled posts have image+clip).
  const m = post.media.find((x) => x.mimeType.startsWith("video/")) ?? post.media[0];
  if (!m) {
    return (
      <div className={`flex items-center justify-center bg-neutral-200 text-[11px] text-neutral-400 ${className}`}>
        media attaches before publish
      </div>
    );
  }
  if (m.mimeType.startsWith("video/")) {
    return (
      <video
        ref={videoRef}
        data-replica-video
        src={mediaUrl(m)}
        autoPlay
        muted
        loop
        playsInline
        controls={controls}
        onPlay={() => onPauseState?.(false)}
        onPause={() => onPauseState?.(true)}
        // Autoplay can be refused (Safari Low Power Mode) — show the play badge.
        onLoadedData={(e) => onPauseState?.(e.currentTarget.paused)}
        className={`${className} object-cover`}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mediaUrl(m)} alt="" className={`${className} object-cover`} />;
}

/* ── shared svg icons ── */
const I = {
  heart: (c = "currentColor") => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 21s-7.5-4.7-10-9.2C.5 8 2.4 4.5 6 4.5c2.2 0 3.6 1.2 4.4 2.4h3.2c.8-1.2 2.2-2.4 4.4-2.4 3.6 0 5.5 3.5 4 7.3C19.5 16.3 12 21 12 21Z" stroke={c} strokeWidth="1.7" strokeLinejoin="round" transform="scale(0.92) translate(1,0)" />
    </svg>
  ),
  comment: (c = "currentColor") => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M21 11.5a8.5 8.5 0 0 1-12.7 7.4L3 21l2-5.2A8.5 8.5 0 1 1 21 11.5Z" stroke={c} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  send: (c = "currentColor") => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M21 3 3 10.5l7 3.5m11-11-6 18-5-7m11-11L10 14" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  bookmark: (c = "currentColor") => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M6 3h12v18l-6-4.5L6 21V3Z" stroke={c} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  dots: (c = "currentColor") => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={c}>
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  ),
  thumb: (c = "currentColor") => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M7 10v11H3V10h4Zm3 11h7.6a3 3 0 0 0 2.9-2.3l1.3-5A2.5 2.5 0 0 0 19.4 10H14l1-4.5A2 2 0 0 0 13 3l-3 7v11Z" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  share: (c = "currentColor") => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M14 5l7 7-7 7v-4C7 15 4 17 3 20c0-7 4-11 11-11V5Z" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  music: (c = "currentColor") => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={c}>
      <path d="M9 18a3 3 0 1 1-2-2.8V5l12-2v12a3 3 0 1 1-2-2.8V7L9 8.6V18Z" />
    </svg>
  ),
  play: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={c}>
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  ),
};

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
// Stable pseudo-random engagement per post (deterministic across renders).
function seedNums(post: ReplicaPost): { likes: number; comments: number; shares: number } {
  let h = 0;
  for (const ch of post.body.slice(0, 40)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return { likes: 240 + (h % 1900), comments: 8 + (h % 46), shares: 4 + (h % 28) };
}

/* ── vertical full-bleed replica (IG Reels / TikTok / YT Shorts) ── */
function VerticalReplica({ post, brand }: { post: ReplicaPost; brand: BrandIdentity }) {
  const n = seedNums(post);
  const isTikTok = post.channel === "tiktok";
  const isShorts = post.channel === "youtube";
  const caption = `${post.body}${post.hashtags ? ` ${post.hashtags}` : ""}`;
  const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
    if (el.paused) void el.play();
  };
  const togglePlay = () => {
    const v = videoRef.current ?? undefined;
    const el = v ?? document.querySelector<HTMLVideoElement>("[data-replica-video]");
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPaused(false);
    } else {
      el.pause();
      setPaused(true);
    }
  };
  return (
    <div
      className="relative mx-auto aspect-[9/16] w-full max-w-[300px] cursor-pointer overflow-hidden rounded-[1.6rem] bg-black text-white shadow-2xl ring-1 ring-white/10"
      onClick={hasVideo ? togglePlay : undefined}
      role={hasVideo ? "button" : undefined}
      aria-label={hasVideo ? "Play or pause" : undefined}
    >
      <Media post={post} className="absolute inset-0 h-full w-full" videoRef={videoRef} controls={false} onPauseState={setPaused} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/25" />
      {hasVideo && paused && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7L8 5Z" /></svg>
          </span>
        </span>
      )}
      {/* top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3 text-[12px] font-semibold">
        <span>{isShorts ? "Shorts" : isTikTok ? "For You" : "Reels"}</span>
        <span className="opacity-80">{I.dots("#fff")}</span>
      </div>
      {hasVideo && (
        <button
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="absolute right-3 top-9 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm"
        >
          {muted ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3Zm18.5 3-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4-2.7-2.7 2.7-2.7-1.4-1.4-2.7 2.7Z" transform="scale(0.85) translate(1.5,1.5)"/></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-8.8v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z"/></svg>
          )}
        </button>
      )}
      {/* right rail */}
      <div className="pointer-events-none absolute bottom-16 right-2 flex flex-col items-center gap-4">
        <div className="flex flex-col items-center gap-0.5">{I.heart("#fff")}<span className="text-[10.5px] font-semibold">{fmt(n.likes)}</span></div>
        <div className="flex flex-col items-center gap-0.5">{I.comment("#fff")}<span className="text-[10.5px] font-semibold">{n.comments}</span></div>
        <div className="flex flex-col items-center gap-0.5">{I.share("#fff")}<span className="text-[10.5px] font-semibold">{n.shares}</span></div>
        {isTikTok && (
          <span className="mt-1 flex h-9 w-9 animate-[spin_6s_linear_infinite] items-center justify-center rounded-full bg-neutral-800 ring-2 ring-neutral-700">
            {I.music("#fff")}
          </span>
        )}
      </div>
      {/* bottom-left */}
      <div className="pointer-events-none absolute bottom-3 left-3 right-14">
        <div className="flex items-center gap-2">
          <Avatar brand={brand} size={30} />
          <span className="text-[13px] font-semibold">@{brand.handle}</span>
          <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-semibold ${isShorts ? "bg-[#FF0000]" : "border border-white/80"}`}>
            {isShorts ? "Subscribe" : "Follow"}
          </span>
        </div>
        {post.title && isShorts && <p className="mt-1.5 text-[12.5px] font-semibold leading-snug">{post.title}</p>}
        <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[12px] leading-snug opacity-95">{caption}</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] opacity-85">
          {I.music("#fff")} <span className="truncate">{brand.name} · Original audio</span>
        </p>
      </div>
    </div>
  );
}

/* ── Instagram feed post / carousel ── */
function InstagramReplica({ post, brand }: { post: ReplicaPost; brand: BrandIdentity }) {
  const n = seedNums(post);
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-xl bg-white text-black shadow-2xl ring-1 ring-black/10">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar brand={brand} size={32} ring />
        <div className="leading-tight">
          <p className="text-[13px] font-semibold">{brand.handle}</p>
          <p className="text-[10.5px] text-neutral-500">Original audio</p>
        </div>
        <span className="ml-auto text-neutral-700">{I.dots()}</span>
      </div>
      <div className="relative">
        <Media post={post} className="aspect-[4/5] w-full" />
        {post.format === "carousel" && (
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10.5px] font-semibold text-white">1/5</span>
        )}
      </div>
      <div className="flex items-center gap-3.5 px-3 pt-2.5 text-neutral-900">
        <span className="text-[#FF3040]">{I.heart("#FF3040")}</span>
        {I.comment()}
        {I.send()}
        <span className="ml-auto">{I.bookmark()}</span>
      </div>
      <div className="px-3 pb-3 pt-1.5">
        <p className="text-[12.5px] font-semibold">{fmt(n.likes)} likes</p>
        <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-snug">
          <span className="font-semibold">{brand.handle}</span> {post.body}
          {post.hashtags && <span className="text-[#00376B]"> {post.hashtags}</span>}
        </p>
        <p className="mt-1 text-[11.5px] text-neutral-500">View all {n.comments} comments</p>
        <p className="mt-0.5 text-[10px] uppercase text-neutral-400">2 hours ago</p>
      </div>
    </div>
  );
}

/* ── Facebook ── */
function FacebookReplica({ post, brand }: { post: ReplicaPost; brand: BrandIdentity }) {
  const n = seedNums(post);
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-xl bg-white text-black shadow-2xl ring-1 ring-black/10">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <Avatar brand={brand} size={36} />
        <div className="leading-tight">
          <p className="text-[13.5px] font-semibold">{brand.name}</p>
          <p className="text-[11px] text-neutral-500">2 h · 🌐</p>
        </div>
        <span className="ml-auto text-neutral-500">{I.dots()}</span>
      </div>
      <p className="whitespace-pre-wrap px-3 pb-2.5 text-[13px] leading-relaxed">
        {post.body}
        {post.hashtags && <span className="text-[#1877F2]"> {post.hashtags}</span>}
      </p>
      <Media post={post} className="aspect-square w-full" />
      <div className="flex items-center justify-between px-3 py-1.5 text-[11.5px] text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1877F2] text-[9px] text-white">👍</span>
          {fmt(n.likes)}
        </span>
        <span>{n.comments} comments · {n.shares} shares</span>
      </div>
      <div className="mx-3 mb-1 flex border-t border-neutral-200 py-1 text-[12.5px] font-medium text-neutral-600">
        <span className="flex flex-1 items-center justify-center gap-1.5 py-1">{I.thumb()} Like</span>
        <span className="flex flex-1 items-center justify-center gap-1.5 py-1">{I.comment()} Comment</span>
        <span className="flex flex-1 items-center justify-center gap-1.5 py-1">{I.share()} Share</span>
      </div>
    </div>
  );
}

/* ── LinkedIn ── */
function LinkedInReplica({ post, brand }: { post: ReplicaPost; brand: BrandIdentity }) {
  const n = seedNums(post);
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-xl bg-white text-black shadow-2xl ring-1 ring-black/10">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm font-semibold text-white" style={{ background: "linear-gradient(135deg,#6D5AF7,#FF4E8E)" }}>
          {brand.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
        </span>
        <div className="leading-tight">
          <p className="text-[13.5px] font-semibold">{brand.name}</p>
          <p className="text-[11px] text-neutral-500">1,248 followers</p>
          <p className="text-[11px] text-neutral-500">2h · 🌐</p>
        </div>
        <span className="ml-auto text-[13px] font-semibold text-[#0A66C2]">+ Follow</span>
      </div>
      <p className="whitespace-pre-wrap px-3 pb-2.5 text-[13px] leading-relaxed">
        {post.body}
        {post.hashtags && <span className="font-medium text-[#0A66C2]"> {post.hashtags}</span>}
      </p>
      {post.media.length > 0 && <Media post={post} className="aspect-[1.91/1] w-full" />}
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-neutral-500">
        <span>👍💡❤️ {fmt(n.likes)}</span>
        <span>{n.comments} comments · {n.shares} reposts</span>
      </div>
      <div className="mx-3 mb-1 flex border-t border-neutral-200 py-1 text-[11.5px] font-medium text-neutral-600">
        {["Like", "Comment", "Repost", "Send"].map((a) => (
          <span key={a} className="flex-1 py-1.5 text-center">{a}</span>
        ))}
      </div>
    </div>
  );
}

/* ── Pinterest ── */
function PinterestReplica({ post, brand }: { post: ReplicaPost; brand: BrandIdentity }) {
  return (
    <div className="mx-auto w-full max-w-[280px]">
      <div className="relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-black/10">
        <Media post={post} className="aspect-[2/3] w-full" />
        <span className="absolute right-2.5 top-2.5 rounded-full bg-[#E60023] px-4 py-2 text-[13px] font-semibold text-white">Save</span>
      </div>
      <p className="mt-2 line-clamp-2 text-[13px] font-semibold text-foreground">{post.title ?? post.body.split("\n")[0]}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <Avatar brand={brand} size={24} />
        <span className="text-[12px] text-muted">{brand.name}</span>
      </div>
    </div>
  );
}

/* ── Google Business ── */
function GbpReplica({ post, brand }: { post: ReplicaPost; brand: BrandIdentity }) {
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-xl bg-white text-black shadow-2xl ring-1 ring-black/10">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar brand={brand} size={32} />
        <div className="leading-tight">
          <p className="text-[13.5px] font-semibold">{brand.name}</p>
          <p className="text-[11px] text-neutral-500">★★★★★ 4.9 · Update on Google</p>
        </div>
      </div>
      {post.media.length > 0 && <Media post={post} className="aspect-[1.91/1] w-full" />}
      <p className="whitespace-pre-wrap px-3 pt-2.5 text-[13px] leading-relaxed">{post.body}</p>
      <div className="px-3 pb-3 pt-2">
        <span className="text-[13px] font-semibold text-[#1A73E8]">Learn more</span>
      </div>
    </div>
  );
}

/** The one entry point: exact-replica preview for any channel/format. */
export function PostReplica({ post, brand }: { post: ReplicaPost; brand: BrandIdentity }) {
  const vertical = ["reel", "story", "short", "video"].includes(post.format) || post.channel === "tiktok";
  if (post.channel === "tiktok" || post.channel === "youtube" || (post.channel === "instagram" && vertical)) {
    return <VerticalReplica post={post} brand={brand} />;
  }
  switch (post.channel) {
    case "instagram":
      return <InstagramReplica post={post} brand={brand} />;
    case "facebook":
      return <FacebookReplica post={post} brand={brand} />;
    case "linkedin":
      return <LinkedInReplica post={post} brand={brand} />;
    case "pinterest":
      return <PinterestReplica post={post} brand={brand} />;
    case "gbp":
      return <GbpReplica post={post} brand={brand} />;
    default:
      return <FacebookReplica post={post} brand={brand} />;
  }
}
