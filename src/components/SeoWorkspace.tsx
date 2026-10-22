"use client";

import { useState } from "react";
import { SeoHub, type SeoReport } from "@/components/SeoHub";
import { ContentBoard, type DraftRow } from "@/components/ContentBoard";
import { GbpBoard, type GbpReport } from "@/components/GbpBoard";

const TABS = [
  { id: "audit", label: "Audit" },
  { id: "content", label: "Content" },
  { id: "gbp", label: "Google Business" },
] as const;

export function SeoWorkspace({
  audit,
  drafts,
  gbp,
}: {
  audit: SeoReport[];
  drafts: DraftRow[];
  gbp: GbpReport[];
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("audit");
  return (
    <div>
      <div className="mb-6 inline-flex rounded-xl border border-border bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-gradient-accent text-white shadow-glow" : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "audit" && <SeoHub reports={audit} />}
      {tab === "content" && <ContentBoard drafts={drafts} />}
      {tab === "gbp" && <GbpBoard reports={gbp} />}
    </div>
  );
}
