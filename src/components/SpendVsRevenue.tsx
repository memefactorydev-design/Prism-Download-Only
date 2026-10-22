"use client";

// Spend vs Revenue (Meta): monthly Meta spend against WON-DEAL revenue —
// the honest ROAS for a high-ticket business where sales close offline.
// Revenue rows come from the deals ledger (manual entry below, or the
// /api/deals/webhook endpoint for n8n/CRM pushes).

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface MonthlyRowDTO {
  month: string;
  metaSpend: number;
  metaRevenue: number;
  metaDeals: number;
  roas: number | null;
  googleSpend?: number;
  googleRevenue?: number;
  googleDeals?: number;
  googleRoas?: number | null;
  allRevenue: number;
}

export interface DealDTO {
  id: string;
  wonAt: string;
  amount: number;
  source: string;
  name: string | null;
  createdVia: string;
}

const gbp = (n: number) =>
  `£${Math.round(n).toLocaleString("en-GB")}`;

function RoasCell({ roas }: { roas: number | null }) {
  if (roas === null) return <span className="text-faint">—</span>;
  const cls = roas >= 1 ? "text-success" : "text-danger";
  return <span className={`font-semibold ${cls}`}>{roas.toFixed(1)}×</span>;
}

export function SpendVsRevenue({
  rows,
  totals,
  deals,
  metaConnected,
}: {
  rows: MonthlyRowDTO[];
  totals: MonthlyRowDTO;
  deals: DealDTO[];
  metaConnected: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [wonAt, setWonAt] = useState("");
  const [source, setSource] = useState("meta");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeals, setShowDeals] = useState(false);

  // Google columns appear only when there's Google activity to show.
  const hasGoogle = rows.some((r) => (r.googleSpend ?? 0) > 0 || (r.googleRevenue ?? 0) > 0);

  async function logDeal() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(amount),
        wonAt: wonAt ? new Date(wonAt).toISOString() : undefined,
        source,
        name: name || undefined,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) setError(body.error ?? "Could not log the deal.");
    else {
      setAmount("");
      setName("");
      router.refresh();
    }
  }

  async function removeDeal(id: string) {
    if (!confirm("Remove this deal?")) return;
    await fetch(`/api/deals/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="card mb-6 p-5">
      <h2 className="font-display text-base font-semibold text-foreground">
        Spend vs Revenue{hasGoogle ? "" : " (Meta)"}
      </h2>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Nothing to show yet — log your first won deal below
          {metaConnected ? "" : ", and complete the Meta connection so spend syncs automatically"}.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-faint">
                <th className="pb-2">Month</th>
                <th className="pb-2 text-right">Meta spend</th>
                <th className="pb-2 text-right">Meta revenue</th>
                <th className="pb-2 text-right">Meta deals</th>
                <th className="pb-2 text-right">Meta ROAS</th>
                {hasGoogle && (
                  <>
                    <th className="pb-2 text-right">Google spend</th>
                    <th className="pb-2 text-right">Google revenue</th>
                    <th className="pb-2 text-right">Google ROAS</th>
                  </>
                )}
                <th className="pb-2 text-right">All revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-t border-border">
                  <td className="py-2.5 font-medium text-foreground">{r.month}</td>
                  <td className="py-2.5 text-right text-muted">{gbp(r.metaSpend)}</td>
                  <td className="py-2.5 text-right text-muted">{gbp(r.metaRevenue)}</td>
                  <td className="py-2.5 text-right text-muted">{r.metaDeals}</td>
                  <td className="py-2.5 text-right"><RoasCell roas={r.roas} /></td>
                  {hasGoogle && (
                    <>
                      <td className="py-2.5 text-right text-muted">{gbp(r.googleSpend ?? 0)}</td>
                      <td className="py-2.5 text-right text-muted">{gbp(r.googleRevenue ?? 0)}</td>
                      <td className="py-2.5 text-right"><RoasCell roas={r.googleRoas ?? null} /></td>
                    </>
                  )}
                  <td className="py-2.5 text-right text-muted">{gbp(r.allRevenue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-accent/50 font-semibold text-foreground">
                <td className="py-2.5">Total</td>
                <td className="py-2.5 text-right">{gbp(totals.metaSpend)}</td>
                <td className="py-2.5 text-right">{gbp(totals.metaRevenue)}</td>
                <td className="py-2.5 text-right">{totals.metaDeals}</td>
                <td className="py-2.5 text-right"><RoasCell roas={totals.roas} /></td>
                {hasGoogle && (
                  <>
                    <td className="py-2.5 text-right">{gbp(totals.googleSpend ?? 0)}</td>
                    <td className="py-2.5 text-right">{gbp(totals.googleRevenue ?? 0)}</td>
                    <td className="py-2.5 text-right"><RoasCell roas={totals.googleRoas ?? null} /></td>
                  </>
                )}
                <td className="py-2.5 text-right">{gbp(totals.allRevenue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-faint">
        Spend syncs from your ad accounts{metaConnected ? "" : " once the Meta connection is completed"}. Revenue
        = won deals by source and won date — logged below, marked sold on the Leads page, or sent in by your CRM.
      </p>

      {/* Log a won deal */}
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
        <label className="block text-xs text-muted">
          <span className="mb-1 block">Amount (£)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="66140" className="input w-28" inputMode="decimal" />
        </label>
        <label className="block text-xs text-muted">
          <span className="mb-1 block">Won date</span>
          <input type="date" value={wonAt} onChange={(e) => setWonAt(e.target.value)} className="input w-40" />
        </label>
        <label className="block text-xs text-muted">
          <span className="mb-1 block">Source</span>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="input w-auto">
            <option value="meta">Meta</option>
            <option value="google">Google</option>
            <option value="organic">Organic</option>
            <option value="referral">Referral</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block flex-1 text-xs text-muted min-w-40">
          <span className="mb-1 block">Client / project (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Smith project" className="input" />
        </label>
        <button onClick={logDeal} disabled={busy || !amount} className="btn btn-primary">
          {busy ? "Logging…" : "Log won deal"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {deals.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowDeals((s) => !s)} className="text-xs font-medium text-muted hover:text-foreground">
            {showDeals ? "Hide" : "Show"} recent deals ({deals.length})
          </button>
          {showDeals && (
            <ul className="mt-2 space-y-1">
              {deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-1.5 text-xs">
                  <span className="text-muted">
                    {new Date(d.wonAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                    {" · "}
                    <span className="font-semibold text-foreground">{gbp(d.amount)}</span>
                    {" · "}
                    {d.source}
                    {d.name ? ` · ${d.name}` : ""}
                    {d.createdVia === "webhook" ? " · sent by your CRM" : ""}
                  </span>
                  <button onClick={() => removeDeal(d.id)} className="text-danger/70 hover:text-danger">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
