// Public status page — launch hygiene (P5.5). Reads the same health probe
// anyone can curl at /api/health.

import { Logo } from "@/components/ui/Logo";

// The operator of this instance sets SUPPORT_EMAIL in .env.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@example.com";

export const dynamic = "force-dynamic";

async function health() {
  try {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    return (await res.json()) as { ok: boolean; checks: Record<string, { ok: boolean; detail?: string }>; at: string };
  } catch {
    return { ok: false, checks: {}, at: new Date().toISOString() };
  }
}

export default async function StatusPage() {
  const h = await health();
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <Logo />
      <h1 className="mt-8 font-display text-2xl font-bold tracking-[-0.02em]">
        {h.ok ? "All systems operational" : "Some systems are struggling"}
      </h1>
      <p className="mt-1 text-sm text-muted">Checked {new Date(h.at).toLocaleString("en-GB")}</p>
      <div className="mt-6 space-y-2">
        {Object.entries(h.checks).map(([name, c]) => (
          <div key={name} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <span className={`h-2.5 w-2.5 rounded-full ${c.ok ? "bg-emerald-500" : "bg-red-500"}`} />
            <span className="text-sm font-medium capitalize">{name}</span>
            {c.detail && <span className="ml-auto text-xs text-faint">{c.detail}</span>}
          </div>
        ))}
      </div>
      <p className="mt-8 text-xs text-faint">
        Having trouble? Email <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </main>
  );
}
