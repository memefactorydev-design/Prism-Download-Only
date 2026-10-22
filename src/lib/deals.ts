// Won-deals ledger + the monthly Spend vs Revenue rollup for /ads.
// Spend comes from RoasSnapshot rows (Meta Marketing API, once connected);
// revenue comes from Deal rows — real won business, not pixel conversions.

import type { Deal } from "@prisma/client";
import { db } from "@/lib/db";

export const DEAL_SOURCES = ["meta", "google", "organic", "referral", "other"] as const;

export interface DealInput {
  amount: number;
  wonAt?: string; // ISO; defaults to now
  source?: string;
  name?: string;
  notes?: string;
  createdVia?: "manual" | "webhook";
}

// The ledger is scoped per user: "" is the business's ledger (admin + the CRM
// webhook), any other scopeUserId is that beta user's own sandbox.
export async function createDeal(input: DealInput, scopeUserId = ""): Promise<Deal> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Deal amount must be a positive number (GBP).");
  const wonAt = input.wonAt ? new Date(input.wonAt) : new Date();
  if (Number.isNaN(wonAt.getTime())) throw new Error("wonAt is not a valid date.");
  const source = (DEAL_SOURCES as readonly string[]).includes(input.source ?? "") ? input.source! : "meta";
  return db.deal.create({
    data: {
      userId: scopeUserId,
      amount,
      wonAt,
      source,
      name: input.name?.trim().slice(0, 200) || null,
      notes: input.notes?.trim().slice(0, 1000) || null,
      createdVia: input.createdVia === "webhook" ? "webhook" : "manual",
    },
  });
}

export interface MonthlyRoasRow {
  month: string; // "Jan 26"
  monthKey: string; // "2026-01" (sort key)
  metaSpend: number;
  metaRevenue: number;
  metaDeals: number;
  roas: number | null; // meta ROAS; null when no spend that month
  googleSpend: number;
  googleRevenue: number;
  googleDeals: number;
  googleRoas: number | null;
  allRevenue: number;
}

export interface SpendVsRevenue {
  rows: MonthlyRoasRow[];
  totals: {
    metaSpend: number;
    metaRevenue: number;
    metaDeals: number;
    roas: number | null;
    googleSpend: number;
    googleRevenue: number;
    googleDeals: number;
    googleRoas: number | null;
    allRevenue: number;
  };
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${String(y).slice(2)}`;
};

/** Monthly ad spend (per network) vs won-deal revenue, oldest month first. */
export async function spendVsRevenue(months = 12, scopeUserId = ""): Promise<SpendVsRevenue> {
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [snapshots, deals] = await Promise.all([
    db.roasSnapshot.findMany({ where: { date: { gte: since }, userId: scopeUserId } }),
    db.deal.findMany({ where: { wonAt: { gte: since }, userId: scopeUserId } }),
  ]);

  const byMonth = new Map<string, MonthlyRoasRow>();
  const ensure = (key: string): MonthlyRoasRow => {
    let row = byMonth.get(key);
    if (!row) {
      row = {
        month: monthLabel(key),
        monthKey: key,
        metaSpend: 0,
        metaRevenue: 0,
        metaDeals: 0,
        roas: null,
        googleSpend: 0,
        googleRevenue: 0,
        googleDeals: 0,
        googleRoas: null,
        allRevenue: 0,
      };
      byMonth.set(key, row);
    }
    return row;
  };

  for (const s of snapshots) {
    const row = ensure(monthKey(s.date));
    if (s.network === "google") row.googleSpend += s.spend;
    else row.metaSpend += s.spend;
  }
  for (const d of deals) {
    const row = ensure(monthKey(d.wonAt));
    row.allRevenue += d.amount;
    if (d.source === "meta") {
      row.metaRevenue += d.amount;
      row.metaDeals += 1;
    } else if (d.source === "google") {
      row.googleRevenue += d.amount;
      row.googleDeals += 1;
    }
  }

  const rows = [...byMonth.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  for (const r of rows) {
    r.roas = r.metaSpend > 0 ? r.metaRevenue / r.metaSpend : null;
    r.googleRoas = r.googleSpend > 0 ? r.googleRevenue / r.googleSpend : null;
  }

  const totals = rows.reduce(
    (t, r) => ({
      metaSpend: t.metaSpend + r.metaSpend,
      metaRevenue: t.metaRevenue + r.metaRevenue,
      metaDeals: t.metaDeals + r.metaDeals,
      roas: null as number | null,
      googleSpend: t.googleSpend + r.googleSpend,
      googleRevenue: t.googleRevenue + r.googleRevenue,
      googleDeals: t.googleDeals + r.googleDeals,
      googleRoas: null as number | null,
      allRevenue: t.allRevenue + r.allRevenue,
    }),
    {
      metaSpend: 0,
      metaRevenue: 0,
      metaDeals: 0,
      roas: null as number | null,
      googleSpend: 0,
      googleRevenue: 0,
      googleDeals: 0,
      googleRoas: null as number | null,
      allRevenue: 0,
    }
  );
  totals.roas = totals.metaSpend > 0 ? totals.metaRevenue / totals.metaSpend : null;
  totals.googleRoas = totals.googleSpend > 0 ? totals.googleRevenue / totals.googleSpend : null;
  return { rows, totals };
}

export async function listRecentDeals(take = 12, scopeUserId = ""): Promise<Deal[]> {
  return db.deal.findMany({ where: { userId: scopeUserId }, orderBy: { wonAt: "desc" }, take });
}
