"use client";

// Studio's two rooms: Create (the golden path) and Trends (the research that
// feeds it). Server-rendered children; this is just the switch.

import { useState } from "react";

export function StudioTabs({ create, trends }: { create: React.ReactNode; trends: React.ReactNode }) {
  const [tab, setTab] = useState<"create" | "trends">("create");
  return (
    <div>
      <div className="mb-6 inline-flex rounded-xl border border-border p-1">
        {(
          [
            { key: "create", label: "Create" },
            { key: "trends", label: "Trends" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-gradient-accent text-white" : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={tab === "create" ? "" : "hidden"}>{create}</div>
      <div className={tab === "trends" ? "" : "hidden"}>{trends}</div>
    </div>
  );
}
