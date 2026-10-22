"use client";

// The live dashboard: KPI tiles, monthly spend-vs-revenue bars, the lead
// pipeline, and top campaigns. Auto-refreshes every 60s while open.
// Chart discipline per the dataviz method: two validated series colours
// (#8B5CF6 spend / #0D9488 revenue — pass light+dark), thin rounded bars with
// 2px gaps, one axis, legend + hover tooltips, table view alongside on /ads.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardKpis } from "@/lib/reports";
import type { MonthlyRowDTO } from "@/components/SpendVsRevenue";

const SPEND = "#8B5CF6";
const REVENUE = "#0D9488";

const gbp = (n: number) =>
  n >= 10_000 ? `£${Math.round(n / 1000).toLocaleString("en-GB")}k` : `£${Math.round(n).toLocaleString("en-GB")}`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1.5 text-[26px] font-bold leading-none tracking-[-0.02em] text-foreground">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** Paired monthly bars, spend vs revenue. One axis, hover tooltip per pair. */
function SpendRevenueChart({ rows }: { rows: MonthlyRowDTO[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = rows.slice(-12);
  const max = Math.max(1, ...data.map((r) => Math.max(r.metaSpend + (r.googleSpend ?? 0), r.metaRevenue + (r.googleRevenue ?? 0), r.allRevenue)));
  const W = 720;
  const H = 200;
  const pad = { l: 6, r: 6, t: 14, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const groupW = iw / Math.max(1, data.length);
  const barW = Math.min(16, Math.max(6, groupW * 0.28));

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-foreground">Spend vs revenue, monthly</h3>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SPEND }} /> Ad spend
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: REVENUE }} /> Won revenue
          </span>
        </div>
      </div>
      {data.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No months to show yet.</p>
      ) : (
        <div className="relative mt-3 overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="Monthly ad spend vs won revenue">
            {/* recessive baseline only — values live in the tooltip */}
            <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="currentColor" strokeOpacity="0.15" />
            {data.map((r, i) => {
              const spend = r.metaSpend + (r.googleSpend ?? 0);
              const revenue = r.allRevenue;
              const x0 = pad.l + i * groupW + groupW / 2;
              const sH = Math.max(2, (spend / max) * ih);
              const rH = Math.max(2, (revenue / max) * ih);
              const active = hover === i;
              return (
                <g
                  key={r.month}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* generous hit target */}
                  <rect x={x0 - groupW / 2} y={pad.t} width={groupW} height={ih} fill="transparent" />
                  <rect
                    x={x0 - barW - 1}
                    y={H - pad.b - sH}
                    width={barW}
                    height={sH}
                    rx={4}
                    fill={SPEND}
                    opacity={hover === null || active ? 1 : 0.45}
                  />
                  <rect
                    x={x0 + 1}
                    y={H - pad.b - rH}
                    width={barW}
                    height={rH}
                    rx={4}
                    fill={REVENUE}
                    opacity={hover === null || active ? 1 : 0.45}
                  />
                  <text x={x0} y={H - 7} textAnchor="middle" className="fill-current text-[10px]" opacity="0.55">
                    {r.month.split(" ")[0]}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-1 rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-lg"
              style={{ left: `${((hover + 0.5) / data.length) * 100}%`, transform: "translateX(-50%)" }}
            >
              <p className="font-semibold text-foreground">{data[hover].month}</p>
              <p className="mt-0.5 text-muted">
                Spend {gbp(data[hover].metaSpend + (data[hover].googleSpend ?? 0))} · Revenue {gbp(data[hover].allRevenue)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ReportsDashboard({ kpis, monthly }: { kpis: DashboardKpis; monthly: MonthlyRowDTO[] }) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // The "updated" stamp appears from the first auto-refresh on — the initial
  // paint is the server's fresh data, so stamping it would only restate load.
  useEffect(() => {
    timer.current = setInterval(() => {
      router.refresh();
      setUpdatedAt(new Date().toLocaleTimeString("en-GB"));
    }, 60_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [router]);

  const maxPipeline = useMemo(() => Math.max(1, ...kpis.pipeline.map((p) => p.count)), [kpis.pipeline]);
  const statusLabel: Record<string, string> = {
    new: "New",
    contacted: "Contacted",
    booked: "Booked",
    lost: "Lost",
    callback: "Callback",
    no_contact: "No Contact",
  };

  return (
    <div>
      <p className="text-xs text-faint">Live — refreshes every minute{updatedAt ? ` · updated ${updatedAt}` : ""}</p>

      {/* KPI tiles (30 days) */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="Ad spend · 30d"
          value={gbp(kpis.adSpend)}
          sub={kpis.googleSpend > 0 ? `${gbp(kpis.metaSpend)} Meta · ${gbp(kpis.googleSpend)} Google` : "Meta"}
        />
        <Tile label="Won revenue · 30d" value={gbp(kpis.revenue)} sub={`${kpis.dealCount} deal${kpis.dealCount === 1 ? "" : "s"} banked`} />
        <Tile
          label="Blended ROAS"
          value={kpis.blendedRoas === null ? "—" : `${kpis.blendedRoas.toFixed(1)}×`}
          sub="revenue ÷ all ad spend"
        />
        <Tile
          label="Leads · 30d"
          value={String(kpis.leadsNew)}
          sub={kpis.leadConversion === null ? "no new leads yet" : `${Math.round(kpis.leadConversion * 100)}% booked`}
        />
        <Tile label="Posts published · 30d" value={String(kpis.postsPublished)} />
        {kpis.gscClicks !== null ? (
          <Tile label="Search clicks · 28d" value={kpis.gscClicks.toLocaleString("en-GB")} sub="Google Search Console" />
        ) : (
          <Tile label="Newsletter emails · 30d" value={String(kpis.newslettersSent)} />
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <SpendRevenueChart rows={monthly} />

        {/* Pipeline — counts with quiet bars, labels carry identity */}
        <div className="card p-4">
          <h3 className="font-display text-sm font-semibold text-foreground">Lead pipeline</h3>
          <div className="mt-3 space-y-2.5">
            {kpis.pipeline.map((p) => (
              <div key={p.status} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-muted">{statusLabel[p.status] ?? p.status}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/8">
                  <div
                    className="h-full rounded-full bg-foreground/40"
                    style={{ width: `${(p.count / maxPipeline) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs font-semibold text-foreground">{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Channels + Search + Networks + SEO — the full analytics spread */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {/* Social channels: real publishing activity per channel */}
        <div className="card p-4">
          <h3 className="font-display text-sm font-semibold text-foreground">Channels · {kpis.windowDays}d</h3>
          {kpis.channelPosts.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nothing published in this window yet.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {kpis.channelPosts.map((c) => (
                <div key={c.channel} className="rounded-lg border border-border p-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                    {c.channel === "gbp" ? "Google Business" : c.channel}
                  </p>
                  <p className="mt-1 text-lg font-bold leading-none text-foreground">{c.published}</p>
                  <p className="mt-1 text-[11px] text-muted">
                    published{c.scheduled ? ` · ${c.scheduled} scheduled` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-faint">
            Publishing volume from your calendar
            {kpis.gbpPostsPublished > 0 ? ` · ${kpis.gbpPostsPublished} Google Business post(s) live` : ""}.
          </p>
        </div>

        {/* Facebook + Instagram engagement, straight from the Graph API */}
        <div className="card p-4">
          <h3 className="font-display text-sm font-semibold text-foreground">Facebook &amp; Instagram engagement</h3>
          {!kpis.social ? (
            <p className="mt-3 text-sm text-muted">
              Connect Meta on the Connections page to see page reach, followers and per-post engagement here.
            </p>
          ) : kpis.social.error ? (
            <p className="mt-3 text-sm text-muted">{kpis.social.error}</p>
          ) : (
            <div className="mt-3 space-y-4">
              {kpis.social.facebook && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                    Facebook · {kpis.social.facebook.pageName}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-faint">Followers</p>
                      <p className="text-lg font-bold text-foreground">
                        {kpis.social.facebook.followers?.toLocaleString("en-GB") ?? "—"}
                      </p>
                    </div>
                    {/* Meta deprecated page reach metrics for new tokens — only shown when returned */}
                    {kpis.social.facebook.impressions28d !== null && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-faint">Reach · 28d</p>
                        <p className="text-lg font-bold text-foreground">
                          {kpis.social.facebook.impressions28d.toLocaleString("en-GB")}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-faint">Engagements · 28d</p>
                      <p className="text-lg font-bold text-foreground">
                        {kpis.social.facebook.engagements28d?.toLocaleString("en-GB") ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-faint">Avg likes/post</p>
                      <p className="text-lg font-bold text-foreground">{kpis.social.facebook.avgLikes}</p>
                    </div>
                    {kpis.social.facebook.impressions28d === null && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-faint">Avg comments</p>
                        <p className="text-lg font-bold text-foreground">{kpis.social.facebook.avgComments}</p>
                      </div>
                    )}
                  </div>
                  {kpis.social.facebook.topPost && (
                    <p className="mt-2 truncate text-xs text-muted">
                      Top post: “{kpis.social.facebook.topPost.text || "(photo/video)"}” —{" "}
                      {kpis.social.facebook.topPost.likes} likes · {kpis.social.facebook.topPost.comments} comments
                      {kpis.social.facebook.topPost.shares ? ` · ${kpis.social.facebook.topPost.shares} shares` : ""}
                    </p>
                  )}
                </div>
              )}
              {kpis.social.instagram && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                    Instagram · @{kpis.social.instagram.username}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-faint">Followers</p>
                      <p className="text-lg font-bold text-foreground">
                        {kpis.social.instagram.followers?.toLocaleString("en-GB") ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-faint">Avg likes/post</p>
                      <p className="text-lg font-bold text-foreground">{kpis.social.instagram.avgLikes}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-faint">Avg comments</p>
                      <p className="text-lg font-bold text-foreground">{kpis.social.instagram.avgComments}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-faint">Recent posts</p>
                      <p className="text-lg font-bold text-foreground">{kpis.social.instagram.recentPosts}</p>
                    </div>
                  </div>
                  {kpis.social.instagram.topPost && (
                    <p className="mt-2 truncate text-xs text-muted">
                      Top post: “{kpis.social.instagram.topPost.caption || "(visual)"}” —{" "}
                      {kpis.social.instagram.topPost.likes} likes · {kpis.social.instagram.topPost.comments} comments
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search Console: measured search analytics */}
        <div className="card p-4">
          <h3 className="font-display text-sm font-semibold text-foreground">Search · Google Search Console</h3>
          {!kpis.gsc ? (
            <p className="mt-3 text-sm text-muted">
              Connect Google Search Console on the Connections page to see your real queries, clicks and
              positions here.
            </p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-faint">Clicks · 28d</p>
                  <p className="text-lg font-bold text-foreground">{kpis.gsc.clicks.toLocaleString("en-GB")}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-faint">Impressions</p>
                  <p className="text-lg font-bold text-foreground">{kpis.gsc.impressions.toLocaleString("en-GB")}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-faint">Avg position</p>
                  <p className="text-lg font-bold text-foreground">{kpis.gsc.avgPosition.toFixed(1)}</p>
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                {kpis.gsc.topQueries.map((q) => (
                  <div key={q.key} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate text-muted">{q.key}</span>
                    <span className="shrink-0 text-faint">
                      {q.clicks} clicks · pos {q.position.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Ad network analytics */}
        {(["meta", "google"] as const).map((n) => {
          const s = n === "meta" ? kpis.meta : kpis.google;
          const label = n === "meta" ? "Meta ads" : "Google Ads";
          return (
            <div key={n} className="card p-4">
              <h3 className="font-display text-sm font-semibold text-foreground">{label} · {kpis.windowDays}d</h3>
              {!s ? (
                <p className="mt-3 text-sm text-muted">
                  {n === "google"
                    ? "Connect Google Ads on the Connections page (then run a sync on the Ads page)."
                    : "No Meta spend data in this window — run a sync on the Ads page."}
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-faint">Spend</p>
                    <p className="text-lg font-bold text-foreground">{gbp(s.spend)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-faint">Impressions</p>
                    <p className="text-lg font-bold text-foreground">{s.impressions.toLocaleString("en-GB")}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-faint">Clicks</p>
                    <p className="text-lg font-bold text-foreground">{s.clicks.toLocaleString("en-GB")}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-faint">Pixel ROAS</p>
                    <p className="text-lg font-bold text-foreground">{s.pixelRoas === null ? "—" : `${s.pixelRoas.toFixed(1)}×`}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* SEO / GEO health */}
      <div className="card mt-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-sm font-semibold text-foreground">SEO / GEO</h3>
          {kpis.seo && (
            <span className="text-[11px] text-faint">
              audited {new Date(kpis.seo.auditedAt).toLocaleDateString("en-GB")}
            </span>
          )}
        </div>
        {!kpis.seo ? (
          <p className="mt-2 text-sm text-muted">No audit yet — run one on the SEO / GEO page.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">{kpis.seo.snapshot}</p>
            <p className="mt-2 text-xs text-faint">
              {kpis.seo.openFixes} fix{kpis.seo.openFixes === 1 ? "" : "es"} in the latest audit ·{" "}
              {kpis.contentPublished} content piece{kpis.contentPublished === 1 ? "" : "s"} published this window
            </p>
          </>
        )}
      </div>

      {kpis.topCampaigns.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2">Network</th>
                <th className="px-3 py-2 text-right">Spend (30d)</th>
                <th className="px-3 py-2 text-right">Conv. value</th>
                <th className="px-3 py-2 text-right">Pixel ROAS</th>
              </tr>
            </thead>
            <tbody>
              {kpis.topCampaigns.map((c) => (
                <tr key={`${c.network}:${c.name}`} className="border-b border-border/60">
                  <td className="px-3 py-2.5 font-medium">{c.name}</td>
                  <td className="px-3 py-2.5 capitalize text-muted">{c.network}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{gbp(c.spend)}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{c.revenue === null ? "—" : gbp(c.revenue)}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{c.roas === null ? "—" : `${c.roas.toFixed(1)}×`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-faint">
            “Conv. value” is what the ad platforms report from their own tracking — useful for comparing
            campaigns, never the same thing as banked revenue (that&rsquo;s the deals ledger above).
          </p>
        </div>
      )}
    </div>
  );
}
