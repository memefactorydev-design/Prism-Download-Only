"use client";

import Link from "next/link";
import { STACK_ALIASES } from "@/lib/brand";
import { motion } from "motion/react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Reveal } from "@/components/ui/Reveal";
import { LogoMark } from "@/components/ui/Logo";
import { BLURB } from "@/lib/brand";
import {
  IconStudio,
  IconTemplates,
  IconCalendar,
  IconIdeas,
  IconAds,
  IconSeo,
  IconReports,
  IconGlobe,
  IconSparkles,
  IconArrowRight,
  IconCheck,
  IconRocket,
} from "@/components/ui/icons";

interface Conn {
  provider: string;
  status: string;
}
interface Stats {
  research: number;
  templates: number;
  clips: number;
  posts: number;
  openTickets?: number;
}

// Vendor names stay off this page — everyone sees the Prism-branded stack.
const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(STACK_ALIASES).map(([k, v]) => [k, v.label])
);
const PROVIDER_SUB: Record<string, string> = Object.fromEntries(
  Object.entries(STACK_ALIASES).map(([k, v]) => [k, v.sub])
);

const QUICK = [
  { href: "/studio", label: "Studio", desc: "Cut & mix viral reels", icon: IconStudio, star: true },
  { href: "/templates", label: "Templates", desc: "Viral formats, decoded", icon: IconTemplates, star: true },
  { href: "/sites", label: "Sites", desc: "Build & publish pages", icon: IconGlobe, star: true },
  { href: "/calendar", label: "Calendar", desc: "Schedule & approve", icon: IconCalendar },
  { href: "/ideas", label: "Winning Ads", desc: "Proven ad concepts", icon: IconIdeas },
  { href: "/ads", label: "Meta ads", desc: "ROAS & spend", icon: IconAds },
  { href: "/seo", label: "SEO / GEO", desc: "Site & GBP audits", icon: IconSeo },
  { href: "/reports", label: "Reports", desc: "Weekly supervisor", icon: IconReports },
];

export function OverviewHome({
  connections,
  stats,
  isAdmin,
  engineReady = false,
  brandMissing = false,
}: {
  connections: Conn[];
  stats: Stats;
  isAdmin?: boolean;
  /** The AI engine (Claude Code / Codex sign-in, or an API key) can answer. */
  engineReady?: boolean;
  /** This scope skipped the guided setup — the team is working brand-neutral. */
  brandMissing?: boolean;
}) {
  const isOn = (p: string) => connections.find((c) => c.provider === p)?.status === "connected";
  const connected = connections.filter((c) => c.status === "connected").length;

  const steps = [
    { label: "Set up Prism Mind & Prism Beam", done: engineReady && isOn("postiz"), href: "/connections", hint: "Unlocks AI editing + publishing" },
    { label: "Research a viral template", done: stats.research > 0 || stats.templates > 0, href: "/templates", hint: "Find what's working in your niche" },
    { label: "Cut your first reel", done: stats.clips > 0, href: "/studio", hint: "Drop footage — the AI does the rest" },
    { label: "Schedule your first post", done: stats.posts > 0, href: "/calendar", hint: "Draft → approve → publish" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <div>
      <PageHeader eyebrow="Prism AI" title="Overview" />

      {brandMissing && (
        <Reveal>
          <div className="card mb-6 border-accent/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">Finish setting up your brand</h2>
                <p className="mt-1 text-sm text-muted">
                  Until then the team works brand-neutral. Your website address plus a two-minute quiz briefs every agent on your business.
                </p>
              </div>
              <Link href="/welcome" className="btn btn-primary">
                Set up my brand
                <IconArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Reveal>
      )}

      {/* Hero */}
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-border p-6 sm:p-8">
          <div className="animated-gradient absolute inset-0 opacity-[0.16]" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <div className="mb-3 flex items-center gap-2.5">
                <LogoMark size={40} />
                <span className="font-display text-lg font-bold text-foreground">Welcome back</span>
              </div>
              <p className="text-sm text-muted">{BLURB}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/studio" className="btn btn-primary">
                  <IconStudio className="h-4 w-4" />
                  New reel
                </Link>
                <Link href="/templates" className="btn btn-secondary">
                  <IconSparkles className="h-4 w-4" />
                  Research templates
                </Link>
              </div>
            </div>
            <div className="flex gap-3">
              <Stat label="Reels" value={stats.clips} />
              <Stat label="Templates" value={stats.templates} />
              <Stat label="Posts" value={stats.posts} />
              {isAdmin && (stats.openTickets ?? 0) > 0 && <Stat label="Open tickets" value={stats.openTickets ?? 0} href="/tickets" />}
            </div>
          </div>
        </div>
      </Reveal>

      {/* Getting started */}
      {doneCount < steps.length && (
        <Reveal i={1}>
          <div className="mt-6 card p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <IconRocket className="h-4 w-4" />
                </span>
                <h2 className="font-display text-base font-semibold text-foreground">Getting started</h2>
              </div>
              <span className="text-xs font-medium text-muted">{doneCount}/{steps.length} done</span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <motion.div
                className="h-full rounded-full bg-gradient-accent"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {steps.map((s) => (
                <Link
                  key={s.label}
                  href={s.href}
                  className="group flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${
                      s.done ? "bg-emerald-500" : "bg-border-strong"
                    }`}
                  >
                    {s.done ? <IconCheck className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-faint" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-medium ${s.done ? "text-muted line-through" : "text-foreground"}`}>
                      {s.label}
                    </span>
                    <span className="block truncate text-xs text-faint">{s.hint}</span>
                  </span>
                  <IconArrowRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                </Link>
              ))}
            </div>
          </div>
        </Reveal>
      )}

      {/* Quick actions */}
      <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-faint">Jump in</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {QUICK.map((q, i) => {
          const Icon = q.icon;
          return (
            <Reveal key={q.href} i={i}>
              <Link href={q.href} className="card card-hover group flex h-full flex-col gap-3 p-4">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-transform group-hover:scale-110 ${
                    q.star ? "bg-gradient-accent text-white shadow-glow" : "bg-accent-soft text-accent"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">{q.label}</span>
                  <span className="block text-xs text-muted">{q.desc}</span>
                </span>
              </Link>
            </Reveal>
          );
        })}
      </div>

      {/* Connections */}
      <div className="mt-10 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">Connections</h2>
        <Link href="/connections" className="text-sm font-medium text-accent hover:underline">
          Manage →
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {connections.map((c, i) => {
          const on = c.status === "connected";
          return (
            <Reveal key={c.provider} i={i}>
              <div className="card flex items-center justify-between p-4">
                <div>
                  <div className="text-sm font-semibold text-foreground">{PROVIDER_LABELS[c.provider] ?? c.provider}</div>
                  <div className="text-xs text-muted">{PROVIDER_SUB[c.provider] ?? ""}</div>
                </div>
                <span className={`badge ${on ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-foreground/8 text-muted"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-faint"}`} />
                  {on ? "Connected" : "Not set"}
                </span>
              </div>
            </Reveal>
          );
        })}
      </div>
      {connected < connections.length && (
        <p className="mt-3 text-sm text-muted">
          {connections.length - connected} of {connections.length} services still need connecting — the{" "}
          <Link href="/connections" className="text-accent hover:underline">
            Connections page
          </Link>{" "}
          walks you through each one. Tap the <span className="text-accent">Help</span> button any time for tips.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <div className={`rounded-2xl border border-border bg-card/60 px-4 py-3 text-center ${href ? "card-hover" : ""}`}>
      <div className="font-display text-2xl font-bold text-foreground">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
