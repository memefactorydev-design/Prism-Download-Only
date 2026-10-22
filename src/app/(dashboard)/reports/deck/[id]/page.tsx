// A board deck rendered as 16:9 slides. On screen: scrollable slides. In
// print: one slide per page (landscape) — the browser's "Save as PDF" IS the
// export, no PDF library needed.

import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { BoardDeck } from "@/lib/boarddeck";
import { PrintDeckButton } from "@/components/PrintDeckButton";

export const dynamic = "force-dynamic";

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const report = await db.agentReport.findUnique({ where: { id } });
  if (!report || !report.kind.startsWith("board_deck") || !report.data) notFound();
  // Scope check: members open only their own decks.
  const expectedKind = user.role === "admin" ? null : `board_deck:${user.id}`;
  if (expectedKind && report.kind !== expectedKind) notFound();

  const deck = JSON.parse(report.data) as BoardDeck;

  return (
    <div className="deck-root">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-display text-lg font-semibold">{deck.title}</h1>
          <p className="text-xs text-muted">{deck.period} · generated {report.createdAt.toLocaleDateString("en-GB")}</p>
        </div>
        <PrintDeckButton />
      </div>

      <div className="space-y-6 print:space-y-0">
        {/* Title slide */}
        <section className="deck-slide">
          <div className="flex h-full flex-col justify-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-faint">Marketing performance</p>
            <h2 className="mt-4 max-w-[18ch] font-display text-4xl font-bold leading-tight tracking-[-0.02em]">{deck.title}</h2>
            <p className="mt-3 text-lg text-muted">{deck.period}</p>
          </div>
        </section>

        {deck.slides.map((s, i) => (
          <section key={i} className="deck-slide">
            {s.kicker && <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">{s.kicker}</p>}
            <h2 className="mt-2 font-display text-2xl font-bold tracking-[-0.015em]">{s.title}</h2>

            {s.layout === "kpis" && s.kpis.length > 0 && (
              <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-3">
                {s.kpis.map((k) => (
                  <div key={k.label}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-faint">{k.label}</p>
                    <p className="mt-1 text-4xl font-bold tracking-[-0.02em]">{k.value}</p>
                    {k.note && <p className="mt-1 text-sm text-muted">{k.note}</p>}
                  </div>
                ))}
              </div>
            )}

            {s.layout === "bullets" && s.bullets.length > 0 && (
              <ul className="mt-8 max-w-3xl space-y-4">
                {s.bullets.map((b, j) => (
                  <li key={j} className="flex gap-3 text-lg leading-snug">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {b}
                  </li>
                ))}
              </ul>
            )}

            {s.layout === "table" && s.table.rows.length > 0 && (
              <div className="mt-8 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-border text-left text-xs font-semibold uppercase tracking-wide text-faint">
                      {s.table.headers.map((h, j) => (
                        <th key={j} className={`py-2 ${j > 0 ? "text-right" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.table.rows.map((row, j) => (
                      <tr key={j} className="border-b border-border">
                        {row.map((cell, k) => (
                          <td key={k} className={`py-2.5 ${k > 0 ? "text-right" : "font-medium"}`}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {s.layout === "statement" && s.statement && (
              <p className="mt-10 max-w-[26ch] font-display text-3xl font-semibold leading-snug tracking-[-0.015em]">
                {s.statement}
              </p>
            )}

            {s.footnote && <p className="mt-auto pt-6 text-xs text-faint">{s.footnote}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
