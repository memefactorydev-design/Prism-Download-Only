"use client";

// "Update from my website" — a compressed re-run of First Light screens 1-2.
// Re-reads the member's site, shows the newly inferred brand with "was: …"
// diffs against the saved profile, and saves via /api/brand/refresh (which
// leaves creative licence, channels, planned posts and connections untouched).

import { useState } from "react";
import type { BrandFormValues as FullBrandFormValues } from "@/components/BrandForm";

// The refresh only re-reads the essentials; the quiz answers stay as they are.
type BrandFormValues = Pick<FullBrandFormValues, "businessName" | "whatYouSell" | "audience" | "voice" | "region" | "goals">;

interface InferredBrand {
  businessName: string;
  whatYouSell: string;
  audience: string;
  voice: string;
  region: string;
  goals: string;
  confidence?: string;
}

interface SiteFacts {
  url: string;
  images: string[];
}

const FIELD_LABELS: { key: keyof BrandFormValues; label: string; textarea?: boolean }[] = [
  { key: "businessName", label: "Business name" },
  { key: "whatYouSell", label: "What you sell or do", textarea: true },
  { key: "audience", label: "Who your customers are", textarea: true },
  { key: "voice", label: "Voice / tone" },
  { key: "region", label: "Region" },
  { key: "goals", label: "Marketing goals", textarea: true },
];

export function BrandRefresh({ current, initialUrl }: { current: BrandFormValues; initialUrl: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [values, setValues] = useState<BrandFormValues | null>(null);
  const [site, setSite] = useState<SiteFacts | null>(null);
  const [keepImages, setKeepImages] = useState<string[]>([]);

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboard/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: url }),
      });
      const json = (await res.json()) as { error?: string; brand?: InferredBrand; site?: SiteFacts };
      if (!res.ok || !json.brand) throw new Error(json.error ?? `HTTP ${res.status}`);
      setValues({
        businessName: json.brand.businessName ?? "",
        whatYouSell: json.brand.whatYouSell ?? "",
        audience: json.brand.audience ?? "",
        voice: json.brand.voice ?? "",
        region: json.brand.region ?? "",
        goals: json.brand.goals ?? "",
      });
      setSite(json.site ?? null);
      setKeepImages([]); // additive only — nothing pre-selected on a refresh
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!values) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/brand/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, siteUrl: site?.url ?? url, imageUrls: keepImages }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setOpen(false);
      setStep(1);
      setNotice("Updated — your agents now work from the refreshed brand. Planned posts keep their schedule; new drafts pick this up automatically.");
      // The page shows stale form values until refresh — simplest honest reload.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 rounded-2xl border border-border p-6">
      <h2 className="text-sm font-semibold text-foreground">Changed your website? Refresh your brand from it.</h2>
      <p className="mt-1 text-sm text-muted">
        We&rsquo;ll re-read your site and suggest updates. Your channels, planned posts and connections don&rsquo;t
        change — only the words your AI team works from.
      </p>
      <button className="btn btn-primary mt-4" onClick={() => setOpen(true)}>
        Update from my website
      </button>
      {notice && <p className="mt-3 text-sm text-green-600">{notice}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-surface p-6">
            {step === 1 && (
              <>
                <h3 className="font-display text-base font-semibold text-foreground">Where does your business live now?</h3>
                <input
                  className="input mt-3 w-full"
                  placeholder="yourbusiness.co.uk"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && url.trim() && read()}
                  autoFocus
                />
                {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                <div className="mt-4 flex items-center gap-2">
                  <button className="btn btn-primary" onClick={read} disabled={busy || !url.trim()}>
                    {busy ? "Reading your site…" : "Read my site"}
                  </button>
                  <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </>
            )}
            {step === 2 && values && (
              <>
                <h3 className="font-display text-base font-semibold text-foreground">Here&rsquo;s what we read — correct anything.</h3>
                <div className="mt-3 space-y-3">
                  {FIELD_LABELS.map((f) => {
                    const was = current[f.key]?.trim();
                    const changed = was && was !== values[f.key]?.trim();
                    return (
                      <label key={f.key} className="block text-sm">
                        <span className="font-medium">{f.label}</span>
                        {f.textarea ? (
                          <textarea
                            className="input mt-1 w-full"
                            rows={2}
                            value={values[f.key]}
                            onChange={(e) => setValues((v) => v && { ...v, [f.key]: e.target.value })}
                          />
                        ) : (
                          <input
                            className="input mt-1 w-full"
                            value={values[f.key]}
                            onChange={(e) => setValues((v) => v && { ...v, [f.key]: e.target.value })}
                          />
                        )}
                        {changed && <span className="mt-0.5 block text-xs text-faint">was: {was}</span>}
                      </label>
                    );
                  })}
                </div>
                {site && site.images.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium">New photos we found — tick any to add to your library</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {site.images.slice(0, 6).map((img) => (
                        <button
                          key={img}
                          type="button"
                          onClick={() =>
                            setKeepImages((k) => (k.includes(img) ? k.filter((i) => i !== img) : [...k, img]))
                          }
                          className={`overflow-hidden rounded-lg border-2 ${
                            keepImages.includes(img) ? "border-[var(--accent)]" : "border-transparent opacity-70"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt="" className="aspect-square w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                <div className="mt-5 flex items-center gap-2">
                  <button className="btn btn-primary" onClick={save} disabled={busy}>
                    {busy ? "Updating…" : "Update my brand"}
                  </button>
                  <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
                    Cancel — keep what I have
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
