"use client";

// One click → the supervisor assembles a board-level deck from the live KPIs;
// lands on the slide view, where Download PDF prints it.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateDeckButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/reports/deck", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy(false);
    if (!res.ok || !body.id) {
      setError(body.error ?? `Generation failed (HTTP ${res.status}).`);
      return;
    }
    router.push(`/reports/deck/${body.id}`);
  };

  return (
    <span className="inline-flex items-center gap-3">
      <button onClick={generate} disabled={busy} className="btn btn-primary">
        {busy ? "Building your board report… (a minute or two)" : "📊 Generate board report"}
      </button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </span>
  );
}
