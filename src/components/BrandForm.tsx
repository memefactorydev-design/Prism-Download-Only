"use client";

// The /brand form: the business every agent in this scope creates FOR. Saved
// values become the brand brief injected into every agent run. Three groups:
// the essentials, the details a website rarely says, and where the business is.

import { useState } from "react";

export interface BrandFormValues {
  businessName: string;
  whatYouSell: string;
  audience: string;
  voice: string;
  region: string;
  goals: string;
  products: string;
  priceBand: string;
  usps: string;
  offers: string;
  competitors: string;
  keywords: string;
  hashtags: string;
  seasonality: string;
  locations: string;
  serviceAreas: string;
  address: string;
  phone: string;
  email: string;
}

export const EMPTY_BRAND_VALUES: BrandFormValues = {
  businessName: "",
  whatYouSell: "",
  audience: "",
  voice: "",
  region: "",
  goals: "",
  products: "",
  priceBand: "",
  usps: "",
  offers: "",
  competitors: "",
  keywords: "",
  hashtags: "",
  seasonality: "",
  locations: "",
  serviceAreas: "",
  address: "",
  phone: "",
  email: "",
};

interface Field {
  key: keyof BrandFormValues;
  label: string;
  placeholder: string;
  textarea?: boolean;
  required?: boolean;
}

const GROUPS: { title: string; blurb: string; fields: Field[] }[] = [
  {
    title: "The essentials",
    blurb: "Who you are and who you serve — these steer everything the team writes.",
    fields: [
      { key: "businessName", label: "Business name", placeholder: "e.g. Northside Physio", required: true },
      { key: "whatYouSell", label: "What do you sell or do?", placeholder: "What you offer, and what makes it different from the competition", textarea: true, required: true },
      { key: "audience", label: "Who are your customers?", placeholder: "Who buys from you, and where they are", textarea: true, required: true },
      { key: "voice", label: "Voice / tone", placeholder: "e.g. warm and premium; playful; no-nonsense" },
      { key: "goals", label: "Marketing goals", placeholder: "What should your marketing achieve? e.g. more bookings, more online orders", textarea: true },
    ],
  },
  {
    title: "What the website doesn't say",
    blurb: "Prices, offers, competitors and keywords — the facts that keep the team specific and honest.",
    fields: [
      { key: "products", label: "Products & services", placeholder: "Your main products or services, comma-separated", textarea: true },
      { key: "priceBand", label: "Price band", placeholder: "e.g. £80–£150 per session; projects from £5k" },
      { key: "usps", label: "What sets you apart", placeholder: "2–4 short points, separated by semicolons", textarea: true },
      { key: "offers", label: "Current offers", placeholder: "Live promotions only — the team never invents offers", textarea: true },
      { key: "competitors", label: "Competitors", placeholder: "Names, comma-separated (used for research, never disparaged)" },
      { key: "keywords", label: "Target search terms", placeholder: "What customers type to find you, comma-separated" },
      { key: "hashtags", label: "Brand hashtags", placeholder: "e.g. yourbrand, yourniche (no #)" },
      { key: "seasonality", label: "Seasonal moments", placeholder: "e.g. January rush; wedding season May–September", textarea: true },
    ],
  },
  {
    title: "Where you are",
    blurb: "Locations and areas drive local SEO, Google Business and geo-targeted ads.",
    fields: [
      { key: "locations", label: "Locations", placeholder: "Branches, studios, showrooms or venues with their towns", textarea: true },
      { key: "serviceAreas", label: "Service areas", placeholder: "Towns or regions you serve, comma-separated" },
      { key: "region", label: "Region", placeholder: "e.g. UK, Greater Manchester" },
      { key: "address", label: "Address", placeholder: "Primary postal address" },
      { key: "phone", label: "Phone", placeholder: "Public phone number" },
      { key: "email", label: "Email", placeholder: "Public contact email" },
    ],
  },
];

export function BrandForm({ initial }: { initial: BrandFormValues }) {
  const [values, setValues] = useState<BrandFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setNotice("Saved — your agents now work for this brand.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border p-6">
      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="font-display text-base font-semibold text-foreground">{g.title}</h3>
            <p className="mt-0.5 text-xs text-muted">{g.blurb}</p>
            <div className="mt-3 space-y-4">
              {g.fields.map((f) => (
                <label key={f.key} className="block text-sm">
                  <span className="font-medium">
                    {f.label}
                    {f.required ? " *" : ""}
                  </span>
                  {f.textarea ? (
                    <textarea
                      className="input mt-1 w-full"
                      rows={3}
                      placeholder={f.placeholder}
                      value={values[f.key]}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                  ) : (
                    <input
                      className="input mt-1 w-full"
                      placeholder={f.placeholder}
                      value={values[f.key]}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                  )}
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save brand"}
        </button>
        {notice && <span className="text-sm text-green-600">{notice}</span>}
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </div>
  );
}
