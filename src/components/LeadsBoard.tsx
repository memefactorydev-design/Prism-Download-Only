"use client";

// Leads CRM board: kanban (drag between statuses) + list view, HubSpot-style.
// A pipeline board on @dnd-kit, in house style.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";

export interface LeadDTO {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  detail: string | null;
  score: number | null;
  scoreReason: string | null;
  status: string;
  subscribed: boolean;
  createdAt: string;
}

const COLUMNS: { key: string; label: string; tint: string }[] = [
  { key: "new", label: "New", tint: "#6D5AF7" },
  { key: "contacted", label: "Contacted", tint: "#4C6FFF" },
  { key: "booked", label: "Booked", tint: "#2BD9A9" },
  { key: "callback", label: "Callback", tint: "#FF9E5A" },
  { key: "no_contact", label: "No Contact", tint: "#71717F" },
  { key: "lost", label: "Lost", tint: "#FF4E8E" },
];

function scoreTone(score: number | null): string {
  if (score == null) return "bg-foreground/10 text-muted";
  if (score >= 70) return "bg-emerald-500/15 text-emerald-500";
  if (score >= 40) return "bg-amber-500/15 text-amber-500";
  return "bg-red-500/15 text-red-400";
}

function LeadCard({
  lead,
  onScore,
  scoring,
  onSold,
}: {
  lead: LeadDTO;
  onScore: (id: string) => void;
  scoring: string | null;
  onSold: (lead: LeadDTO) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined, opacity: isDragging ? 0.4 : 1 }}
      className="cursor-grab rounded-xl border border-border bg-background p-3 active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13.5px] font-semibold leading-tight">{lead.name}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${scoreTone(lead.score)}`}>
          {lead.score ?? "—"}
        </span>
      </div>
      {lead.company && <p className="mt-0.5 text-[12px] text-muted">{lead.company}</p>}
      <p className="mt-1 text-[11.5px] uppercase tracking-wide text-muted/70">{lead.source}</p>
      {lead.detail && <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-muted">{lead.detail}</p>}
      {lead.scoreReason && <p className="mt-1.5 line-clamp-2 text-[11.5px] italic text-muted/80">{lead.scoreReason}</p>}
      <div className="mt-2 flex items-center justify-between gap-1.5">
        <span className="text-[11px] text-muted/60">{new Date(lead.createdAt).toLocaleDateString("en-GB")}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSold(lead);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:text-foreground"
            title="Log the sale — feeds your ROAS automatically"
          >
            💰 Sold
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onScore(lead.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={scoring === lead.id}
            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:text-foreground disabled:opacity-50"
          >
            {scoring === lead.id ? "Scoring…" : "✨ AI score"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Column({ col, leads, children }: { col: (typeof COLUMNS)[number]; leads: LeadDTO[]; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.key}` });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[220px] w-[240px] shrink-0 flex-col gap-2 rounded-2xl border p-2.5 transition-colors ${
        isOver ? "border-foreground/30 bg-foreground/5" : "border-border bg-foreground/[0.02]"
      }`}
    >
      <div className="flex items-center gap-2 px-1.5 pt-1">
        <span className="h-2 w-2 rounded-full" style={{ background: col.tint }} />
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{col.label}</p>
        <span className="ml-auto text-[11.5px] text-muted/60">{leads.length}</span>
      </div>
      {children}
    </div>
  );
}

export function LeadsBoard({ initialLeads }: { initialLeads: LeadDTO[] }) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [scoring, setScoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", source: "manual", detail: "" });
  const [soldFor, setSoldFor] = useState<LeadDTO | null>(null);
  const [soldPrompted, setSoldPrompted] = useState(false); // true when opened by a drag into Booked
  const [sold, setSold] = useState({ amount: "", wonAt: new Date().toISOString().slice(0, 10), notes: "" });
  const [soldBusy, setSoldBusy] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const byStatus = useMemo(() => {
    const map = new Map<string, LeadDTO[]>();
    for (const c of COLUMNS) map.set(c.key, []);
    for (const l of leads) (map.get(l.status) ?? map.get("new"))!.push(l);
    for (const list of map.values()) list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return map;
  }, [leads]);

  const moveLead = async (id: string, status: string) => {
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setLeads(prev);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Couldn't move the lead.");
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const over = e.over?.id;
    if (typeof over === "string" && over.startsWith("col:")) {
      const status = over.slice(4);
      const lead = leads.find((l) => l.id === e.active.id);
      if (lead && lead.status !== status) {
        void moveLead(String(e.active.id), status);
        // Landing in Booked is the natural moment to log the sale — offer,
        // don't force (skippable if it hasn't closed yet).
        if (status === "booked") {
          setSoldFor(lead);
          setSoldPrompted(true);
          setSold({ amount: "", wonAt: new Date().toISOString().slice(0, 10), notes: "" });
        }
      }
    }
  };

  const openSold = (lead: LeadDTO) => {
    setSoldFor(lead);
    setSoldPrompted(false);
    setSold({ amount: "", wonAt: new Date().toISOString().slice(0, 10), notes: "" });
  };

  const submitSold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!soldFor) return;
    setSoldBusy(true);
    setError(null);
    const res = await fetch(`/api/leads/${soldFor.id}/sold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(sold.amount),
        wonAt: sold.wonAt ? new Date(sold.wonAt).toISOString() : undefined,
        notes: sold.notes || undefined,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { lead?: LeadDTO; error?: string };
    setSoldBusy(false);
    if (!res.ok || !body.lead) {
      setError(body.error ?? "Couldn't log the sale.");
      return;
    }
    setLeads((ls) => ls.map((l) => (l.id === soldFor.id ? { ...l, status: "booked", detail: body.lead!.detail } : l)));
    setSoldFor(null);
    router.refresh();
  };

  const scoreLead = async (id: string) => {
    setScoring(id);
    setError(null);
    const res = await fetch(`/api/leads/${id}/score`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { lead?: LeadDTO & { createdAt: string }; error?: string };
    setScoring(null);
    if (!res.ok || !body.lead) setError(body.error ?? "Scoring failed.");
    else setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, score: body.lead!.score, scoreReason: body.lead!.scoreReason } : l)));
  };

  const addLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = (await res.json().catch(() => ({}))) as { lead?: LeadDTO; error?: string };
    if (!res.ok || !body.lead) {
      setError(body.error ?? "Couldn't add the lead.");
      return;
    }
    setLeads((ls) => [body.lead!, ...ls]);
    setForm({ name: "", email: "", phone: "", company: "", source: "manual", detail: "" });
    setShowForm(false);
    router.refresh();
  };

  const removeLead = async (id: string) => {
    setLeads((ls) => ls.filter((l) => l.id !== id));
    await fetch(`/api/leads/${id}`, { method: "DELETE" });
  };

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null;
  const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  return (
    <div>
      {/* Sold dialog — logging the sale feeds ROAS automatically. */}
      {soldFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSoldFor(null)}>
          <form
            onSubmit={submitSold}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-2xl"
          >
            <p className="font-semibold">
              {soldPrompted ? `Booked! Did ${soldFor.name} close?` : `Log the sale — ${soldFor.name}`}
            </p>
            <p className="mt-1 text-xs text-muted">
              The value lands in your revenue ledger against the {soldFor.source === "meta" || soldFor.source === "google" ? `${soldFor.source} ads` : "organic"} column, so ROAS updates itself.
              {soldPrompted ? " Skip if it hasn't closed yet." : ""}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted">
                <span className="mb-1 block">Sold value (£) *</span>
                <input className={input} required inputMode="decimal" placeholder="30000" value={sold.amount} onChange={(e) => setSold({ ...sold, amount: e.target.value })} />
              </label>
              <label className="block text-xs text-muted">
                <span className="mb-1 block">Sold date</span>
                <input className={input} type="date" value={sold.wonAt} onChange={(e) => setSold({ ...sold, wonAt: e.target.value })} />
              </label>
              <label className="col-span-2 block text-xs text-muted">
                <span className="mb-1 block">Notes (optional)</span>
                <input className={input} placeholder="e.g. full project, delivery in March" value={sold.notes} onChange={(e) => setSold({ ...sold, notes: e.target.value })} />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setSoldFor(null)} className="rounded-lg border border-border px-4 py-2 text-sm text-muted">
                {soldPrompted ? "Not sold yet" : "Cancel"}
              </button>
              <button type="submit" disabled={soldBusy || !sold.amount} className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {soldBusy ? "Logging…" : "Log sale"}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(["kanban", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium capitalize ${view === v ? "bg-foreground/10" : "text-muted"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white"
        >
          {showForm ? "Close" : "+ Add lead"}
        </button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {showForm && (
        <form onSubmit={addLead} className="mt-4 grid max-w-3xl grid-cols-1 gap-3 rounded-2xl border border-border p-4 sm:grid-cols-2">
          <input className={input} required placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={input} placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={input} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className={input} placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          <select className={input} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
            {["manual", "site", "referral", "meta", "google", "import"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <textarea className={`${input} sm:col-span-2`} rows={3} placeholder="Detail — what do they want? Budget, timeline, context…" value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
          <button type="submit" className="rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white sm:col-span-2">
            Save lead
          </button>
        </form>
      )}

      {view === "kanban" ? (
        <DndContext
          sensors={sensors}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragEnd={onDragEnd}
        >
          <div className="mt-5 flex gap-3 overflow-x-auto pb-3">
            {COLUMNS.map((col) => (
              <Column key={col.key} col={col} leads={byStatus.get(col.key) ?? []}>
                {(byStatus.get(col.key) ?? []).map((lead) => (
                  <LeadCard key={lead.id} lead={lead} onScore={scoreLead} scoring={scoring} onSold={openSold} />
                ))}
              </Column>
            ))}
          </div>
          <DragOverlay>
            {activeLead && (
              <div className="w-[220px] rounded-xl border border-border bg-background p-3 shadow-xl">
                <p className="text-[13.5px] font-semibold">{activeLead.name}</p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Added</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-border/60">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{l.name}</p>
                    {l.company && <p className="text-xs text-muted">{l.company}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {l.email && <p>{l.email}</p>}
                    {l.phone && <p>{l.phone}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{l.source}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${scoreTone(l.score)}`}>{l.score ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={l.status}
                      onChange={(e) => moveLead(l.id, e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[12.5px]"
                    >
                      {COLUMNS.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-muted">{new Date(l.createdAt).toLocaleDateString("en-GB")}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2.5">
                      <button onClick={() => openSold(l)} className="text-xs text-muted hover:text-foreground">
                        💰 Sold
                      </button>
                      <button onClick={() => removeLead(l.id)} className="text-xs text-red-400 hover:text-red-500">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted">
                    No leads yet — add one above, or connect your website form so enquiries land here automatically.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
