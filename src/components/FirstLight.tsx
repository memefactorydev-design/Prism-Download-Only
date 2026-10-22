"use client";

// First Light — the guided onboarding. An engine check (nothing works without
// one), one question ("where does your business live?"), an inferred Brand
// Prism to correct rather than fill in, a short quiz for what a website rarely
// says, one trust decision, and it ends at value: the first week already made.
// The saved profile becomes the brand brief every agent reads.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

interface Brand {
  businessName: string;
  whatYouSell: string;
  audience: string;
  voice: string;
  region: string;
  goals: string;
  products: string;
  priceBand: string;
  offers: string;
  usps: string;
  locations: string;
  serviceAreas: string;
  competitors: string;
  keywords: string;
  hashtags: string;
  seasonality: string;
  confidence: string;
}
interface SiteFacts {
  url: string;
  colours: string[];
  fonts: string[];
  images: string[];
  phone: string;
  email: string;
  address: string;
  socialLinks: Record<string, string>;
}
interface Draft {
  id: string;
  channel: string;
  format: string;
  title: string | null;
  body: string;
  hashtags: string | null;
  scheduledFor: string | null;
}
interface EngineInfo {
  active: string | null;
  engines: { engine: string; label: string; ready: boolean; installed: boolean; detail: string; howTo: string[] }[];
}

const LICENCES = [
  { id: "full", label: "Full freedom", blurb: "Bold swings, new angles, the AI takes real creative risks." },
  { id: "balanced", label: "Balanced", blurb: "Fresh ideas inside your brand's lane. The default for a reason." },
  { id: "minimal", label: "Keep it close", blurb: "Stays near what you already do; novelty in small doses." },
  { id: "strict", label: "Strict brand control", blurb: "Only your established voice, formats and claims." },
];

const CHANNELS = [
  { id: "instagram", label: "Instagram", group: "Short-form" },
  { id: "tiktok", label: "TikTok", group: "Short-form" },
  { id: "youtube", label: "YouTube", group: "Short-form" },
  { id: "facebook", label: "Facebook", group: "Feed" },
  { id: "linkedin", label: "LinkedIn", group: "Feed" },
  { id: "pinterest", label: "Pinterest", group: "Feed" },
  { id: "gbp", label: "Google Business", group: "Local" },
];

const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.id, c.label]));

const GOAL_PRESETS = [
  { id: "bookings", label: "More bookings & enquiries", text: "More bookings and enquiries" },
  { id: "sales", label: "More online sales", text: "More online sales" },
  { id: "leads", label: "More leads & sign-ups", text: "More leads and sign-ups" },
  { id: "awareness", label: "Awareness & audience growth", text: "Brand awareness and audience growth" },
];

const TOTAL_SCREENS = 5;

// The viewer's motion preference as an external store (SSR renders the
// poster; the client plays the loop unless reduced motion is requested).
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(listener: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}
const motionAllowed = () => !window.matchMedia(REDUCED_MOTION).matches;
const motionUnknown = () => false;

function Field({
  label,
  value,
  onChange,
  rows,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
}) {
  const cls = "input w-full";
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {rows ? (
        <textarea className={cls} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={cls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function FirstLight() {
  const router = useRouter();
  const [screen, setScreen] = useState(1);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [site, setSite] = useState<SiteFacts | null>(null);
  const [keepImages, setKeepImages] = useState<string[]>([]);
  const [goalPreset, setGoalPreset] = useState<string>("bookings");
  const [goalNote, setGoalNote] = useState("");
  const [licence, setLicence] = useState("balanced");
  const [channels, setChannels] = useState<string[]>(["instagram", "facebook"]);
  const [stages, setStages] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // postId → media slot: pending kind, or the delivered file.
  const [media, setMedia] = useState<Record<string, { kind: string; url?: string; pending: boolean }>>({});
  const [weekDone, setWeekDone] = useState<number | null>(null);
  // The AI engine: null = still checking, else what /api/engine reported.
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [engineChecks, setEngineChecks] = useState(0);
  // Play the ambient loop only for people who haven't asked for reduced motion.
  const ambient = useSyncExternalStore(subscribeReducedMotion, motionAllowed, motionUnknown);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/engine${engineChecks ? "?force=1" : ""}`)
      .then((r) => r.json())
      .then((info: EngineInfo) => {
        if (!cancelled) setEngine(info);
      })
      .catch(() => {
        if (!cancelled) setEngine({ active: null, engines: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [engineChecks]);

  const input = "input w-full";
  const patch = (p: Partial<Brand>) => setBrand((b) => (b ? { ...b, ...p } : b));

  const infer = async () => {
    if (!source.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/onboard/infer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    const b = (await res.json().catch(() => ({}))) as { brand?: Brand; site?: SiteFacts; error?: string };
    setBusy(false);
    if (!res.ok || !b.brand || !b.site) {
      setError(b.error ?? "We couldn't read that address — try your homepage URL.");
      return;
    }
    setBrand(b.brand);
    setSite(b.site);
    setKeepImages(b.site.images.slice(0, 6));
    setScreen(2);
  };

  const complete = async () => {
    if (!brand || busy) return;
    setBusy(true);
    setError(null);
    const preset = GOAL_PRESETS.find((g) => g.id === goalPreset);
    const goals = [preset?.text ?? brand.goals, goalNote.trim()].filter(Boolean).join(" — ");
    const res = await fetch("/api/onboard/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...brand,
        goals,
        phone: site?.phone ?? "",
        email: site?.email ?? "",
        address: site?.address ?? "",
        creativeLicence: licence,
        channels,
        imageUrls: keepImages,
        siteUrl: site?.url,
        colours: site?.colours ?? [],
        fonts: (site?.fonts ?? []).join(", "),
        socialLinks: site?.socialLinks ?? {},
      }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setBusy(false);
      setError(b.error ?? "That didn't save — try again.");
      return;
    }
    setBusy(false);
    setScreen(5);
    void firstWeek();
  };

  const firstWeek = async () => {
    setStages(["Warming up…"]);
    const res = await fetch("/api/onboard/first-week", { method: "POST" });
    if (!res.ok || !res.body) {
      setError("The first week couldn't start — you can plan it any time from the Calendar.");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const handle = (line: string) => {
      if (!line.trim()) return;
      try {
        const evt = JSON.parse(line) as {
          type: string;
          label?: string;
          draft?: Draft;
          planned?: number;
          error?: string;
          postId?: string;
          kind?: string;
          url?: string;
        };
        if (evt.type === "stage" && evt.label) setStages((s) => [...s, evt.label!]);
        else if (evt.type === "draft" && evt.draft) setDrafts((d) => [...d, evt.draft!]);
        else if (evt.type === "media_start" && evt.postId)
          setMedia((m) => ({ ...m, [evt.postId!]: { kind: evt.kind ?? "image", pending: true } }));
        else if (evt.type === "media" && evt.postId && evt.url)
          setMedia((m) => ({ ...m, [evt.postId!]: { kind: evt.kind ?? "image", url: evt.url, pending: false } }));
        else if (evt.type === "media_skip" && evt.postId)
          setMedia((m) => {
            const next = { ...m };
            if (next[evt.postId!]?.pending) delete next[evt.postId!];
            return next;
          });
        else if (evt.type === "done") setWeekDone(evt.planned ?? 0);
        else if (evt.type === "error") setError(evt.error ?? "Something went wrong.");
      } catch {
        /* partial line */
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(handle);
    }
    if (buf) handle(buf);
  };

  const engineReady = Boolean(engine?.active);

  return (
    <div className="relative">
      {/* Ambient prism loop behind the flow — poster-only under
          prefers-reduced-motion, opacity themed via .prism-empty-art. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] overflow-hidden" aria-hidden>
        {ambient ? (
          <video
            className="prism-empty-art h-full w-full object-cover"
            src="/welcome-ambient.mp4"
            poster="/welcome-poster.webp"
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
          />
        ) : (
          <Image src="/welcome-poster.webp" alt="" fill sizes="100vw" className="prism-empty-art object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background" />
      </div>

      <div className="relative mx-auto max-w-4xl px-6 py-12">
        {/* progress dots */}
        <div className="mb-10 flex items-center gap-2">
          {Array.from({ length: TOTAL_SCREENS }, (_, i) => i + 1).map((n) => (
            <span key={n} className={`h-1.5 rounded-full transition-all ${n <= screen ? "w-8 bg-gradient-accent" : "w-4 bg-border"}`} />
          ))}
          <button
            onClick={() => {
              document.cookie = "prism_onboard_skip=1;path=/;max-age=2592000";
              router.push("/");
            }}
            className="ml-auto text-xs text-faint hover:text-foreground"
          >
            Skip for now →
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

        {screen === 1 && engine && !engineReady && (
          <div className="mx-auto max-w-2xl pt-6">
            <h1 className="font-display text-3xl font-bold tracking-[-0.02em]">First, give Prism a brain.</h1>
            <p className="mt-3 text-muted">
              Every agent runs on an AI engine you already pay for. Sign in to one of these on this machine — no API credits
              needed — then re-check. (An Anthropic API key also works, on the Connections page.)
            </p>
            <ul className="mt-6 space-y-3">
              {engine.engines
                .filter((e) => e.engine !== "anthropic-api")
                .map((e) => (
                  <li key={e.engine} className="card p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.installed ? "bg-amber-500/15 text-amber-500" : "border border-border text-faint"}`}>
                        {e.installed ? "Installed — sign in" : "Not installed"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{e.detail}</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
                      {e.howTo.map((step) => (
                        <li key={step}>
                          <code className="rounded bg-background px-1 py-0.5 font-mono text-[11px] text-foreground">{step}</code>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={() => setEngineChecks((n) => n + 1)} className="btn btn-primary">
                I&rsquo;ve signed in — re-check
              </button>
              <button onClick={() => router.push("/connections")} className="btn btn-secondary">
                Use an API key instead
              </button>
            </div>
          </div>
        )}

        {screen === 1 && engine && engineReady && (
          <div className="mx-auto max-w-xl pt-10 text-center">
            <h1 className="font-display text-3xl font-bold tracking-[-0.02em]">Where does your business live?</h1>
            <p className="mt-3 text-muted">
              Your website address is enough — we read it and build your marketing brain from what&rsquo;s already yours.
            </p>
            <div className="mt-8 flex gap-2">
              <input
                className={`${input} text-center`}
                placeholder="yourbusiness.co.uk"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && infer()}
                autoFocus
              />
              <button onClick={infer} disabled={busy || !source.trim()} className="btn btn-primary shrink-0">
                {busy ? "Reading your site…" : "Continue"}
              </button>
            </div>
            {busy && <p className="mt-4 text-sm text-muted">Reading the copy, the colours, the photography, the contact details…</p>}
            <p className="mt-6 text-xs text-faint">
              No website yet?{" "}
              <a href="/brand" className="text-accent underline underline-offset-2">
                Fill in your brand by hand
              </a>
              .
            </p>
          </div>
        )}

        {screen === 1 && !engine && <p className="pt-10 text-center text-sm text-muted">Checking which AI engine is signed in…</p>}

        {screen === 2 && brand && site && (
          <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">
                We built this from your website — fix anything that&rsquo;s off.
              </h1>
              <p className="mt-2 text-sm text-faint">{brand.confidence}</p>
              <div className="mt-6 space-y-4">
                <Field label="Business name" value={brand.businessName} onChange={(v) => patch({ businessName: v })} />
                <Field label="What you sell or do" value={brand.whatYouSell} rows={3} onChange={(v) => patch({ whatYouSell: v })} />
                <Field label="Who buys it" value={brand.audience} rows={2} onChange={(v) => patch({ audience: v })} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Tone of voice" value={brand.voice} onChange={(v) => patch({ voice: v })} />
                  <Field label="Where you serve" value={brand.region} onChange={(v) => patch({ region: v })} />
                </div>
                <Field
                  label="Products & services"
                  value={brand.products}
                  rows={2}
                  placeholder="Your main products or services, comma-separated"
                  onChange={(v) => patch({ products: v })}
                />
              </div>

              {(site.phone || site.email || site.address) && (
                <p className="mt-4 text-xs text-muted">
                  Contact details we read: {[site.phone, site.email, site.address].filter(Boolean).join(" · ")}
                  {" — "}edit them later on the Brand page.
                </p>
              )}

              {(site.colours.length > 0 || site.fonts.length > 0) && (
                <div className="mt-6 flex flex-wrap items-center gap-4">
                  {site.colours.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="mr-1 text-xs text-faint">Your colours</span>
                      {site.colours.map((c) => (
                        <span key={c} className="h-6 w-6 rounded-full border border-border" style={{ background: c }} title={c} />
                      ))}
                    </div>
                  )}
                  {site.fonts.length > 0 && <span className="text-xs text-faint">Type: {site.fonts.join(" · ")}</span>}
                </div>
              )}

              {site.images.length > 0 && (
                <div className="mt-6">
                  <p className="text-sm font-medium">Your photos — we found these; keep the good ones</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {site.images.map((u) => {
                      const kept = keepImages.includes(u);
                      return (
                        <button
                          key={u}
                          type="button"
                          onClick={() => setKeepImages((k) => (kept ? k.filter((x) => x !== u) : k.length < 6 ? [...k, u] : k))}
                          className={`relative aspect-square overflow-hidden rounded-lg border-2 ${kept ? "border-accent" : "border-transparent opacity-50"}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- remote preview during onboarding only */}
                          <img src={u} alt="" className="h-full w-full object-cover" />
                          {kept && <span className="absolute right-1 top-1 rounded-full bg-gradient-accent px-1.5 text-[10px] font-bold text-white">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <button onClick={() => setScreen(3)} className="btn btn-primary mt-8">
                That&rsquo;s us →
              </button>
            </div>

            <aside className="space-y-4 text-sm">
              <div className="card p-4">
                <p className="font-medium">What to check</p>
                <p className="mt-1.5 text-muted">The tone of voice and who buys — those two steer everything the team writes.</p>
              </div>
              <div className="card p-4">
                <p className="font-medium">Why it matters</p>
                <p className="mt-1.5 text-muted">
                  Every agent reads this profile before it works. Thirty seconds here saves a hundred small corrections later — and
                  you can refine it any time on the Brand page.
                </p>
              </div>
            </aside>
          </div>
        )}

        {screen === 3 && brand && (
          <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">What the website doesn&rsquo;t say.</h1>
              <p className="mt-2 text-sm text-muted">
                All optional — but every answer makes the team more specific and keeps it honest. It never invents prices, offers or
                competitors.
              </p>

              <h2 className="mt-6 text-sm font-semibold">What should your marketing achieve?</h2>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {GOAL_PRESETS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setGoalPreset(g.id)}
                    className={`rounded-xl border p-3 text-left text-sm transition-colors ${
                      goalPreset === g.id ? "border-accent bg-accent-soft" : "border-border hover:border-accent/50"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <input
                className={`${input} mt-2`}
                placeholder="Anything more specific? e.g. 20 consultations a month"
                value={goalNote}
                onChange={(e) => setGoalNote(e.target.value)}
              />

              <div className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Price band"
                    value={brand.priceBand}
                    placeholder="e.g. £80–£150 per session"
                    onChange={(v) => patch({ priceBand: v })}
                  />
                  <Field
                    label="Current offers"
                    value={brand.offers}
                    placeholder="Live promotions only"
                    onChange={(v) => patch({ offers: v })}
                  />
                </div>
                <Field
                  label="What sets you apart"
                  value={brand.usps}
                  rows={2}
                  placeholder="2–4 short points, separated by semicolons"
                  onChange={(v) => patch({ usps: v })}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Locations"
                    value={brand.locations}
                    placeholder="Branches, studios or venues with their towns"
                    onChange={(v) => patch({ locations: v })}
                  />
                  <Field
                    label="Areas you serve"
                    value={brand.serviceAreas}
                    placeholder="Towns or regions, comma-separated"
                    onChange={(v) => patch({ serviceAreas: v })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Competitors"
                    value={brand.competitors}
                    placeholder="Names, comma-separated"
                    hint="Used for research; never disparaged by name."
                    onChange={(v) => patch({ competitors: v })}
                  />
                  <Field
                    label="Search terms customers use"
                    value={brand.keywords}
                    placeholder="comma-separated"
                    onChange={(v) => patch({ keywords: v })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Brand hashtags" value={brand.hashtags} placeholder="no #, comma-separated" onChange={(v) => patch({ hashtags: v })} />
                  <Field
                    label="Seasonal moments"
                    value={brand.seasonality}
                    placeholder="e.g. January rush; wedding season"
                    onChange={(v) => patch({ seasonality: v })}
                  />
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button onClick={() => setScreen(4)} className="btn btn-primary">
                  Continue →
                </button>
                <button onClick={() => setScreen(2)} className="btn btn-secondary">
                  Back
                </button>
              </div>
            </div>

            <aside className="space-y-4 text-sm">
              <div className="card p-4">
                <p className="font-medium">Why the quiz?</p>
                <p className="mt-1.5 text-muted">
                  Websites rarely say what things cost, who you compete with or where you&rsquo;ll travel to. Those are exactly the facts
                  a good marketer needs — and the facts an AI would otherwise guess.
                </p>
              </div>
              <div className="card p-4">
                <p className="font-medium">Leave blanks blank.</p>
                <p className="mt-1.5 text-muted">Anything you skip is treated as unknown, never invented.</p>
              </div>
            </aside>
          </div>
        )}

        {screen === 4 && (
          <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">How much creative rope do we get?</h1>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {LICENCES.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLicence(l.id)}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      licence === l.id ? "border-accent bg-accent-soft" : "border-border hover:border-accent/50"
                    }`}
                  >
                    <p className="text-sm font-semibold">{l.label}</p>
                    <p className="mt-1 text-xs text-muted">{l.blurb}</p>
                  </button>
                ))}
              </div>

              <h2 className="mt-8 font-display text-lg font-semibold">Where should your content go?</h2>
              <p className="mt-1 text-sm text-faint">Pick what you use today — you can connect the accounts after.</p>
              {["Short-form", "Feed", "Local"].map((group) => (
                <div key={group} className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="w-20 text-xs uppercase tracking-wide text-faint">{group}</span>
                  {CHANNELS.filter((c) => c.group === group).map((c) => {
                    const on = channels.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => setChannels((cur) => (on ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                        className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                          on ? "border-accent bg-accent-soft text-foreground" : "border-border text-muted hover:border-accent/50"
                        }`}
                      >
                        {on ? "✓ " : ""}
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              ))}

              <div className="mt-8 flex gap-3">
                <button onClick={complete} disabled={busy || channels.length === 0} className="btn btn-primary">
                  {busy ? "Saving…" : "Make my first week →"}
                </button>
                <button onClick={() => setScreen(3)} className="btn btn-secondary">
                  Back
                </button>
              </div>
            </div>

            <aside className="space-y-4 text-sm">
              <div className="card p-4">
                <p className="font-medium">Nothing publishes without your approval. Ever.</p>
                <p className="mt-1.5 text-muted">Every post, every ad change waits for your yes — the licence only sets how adventurous the drafts are.</p>
              </div>
              <div className="card p-4">
                <p className="font-medium">No cross-posting.</p>
                <p className="mt-1.5 text-muted">Every platform gets its own native cut — length, caption, hashtags, all of it.</p>
              </div>
            </aside>
          </div>
        )}

        {screen === 5 && (
          <div className="mx-auto max-w-2xl">
            {weekDone === null ? (
              <>
                <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Making your first week…</h1>
                <div className="mt-6 space-y-2.5">
                  {stages.map((s, i) => (
                    <p key={i} className={`text-sm ${i === stages.length - 1 ? "text-foreground" : "text-faint"}`}>
                      {i === stages.length - 1 ? "✨ " : "✓ "}
                      {s}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">
                Your first week is already made. <span className="text-muted">{weekDone} posts planned — here are the first three.</span>
              </h1>
            )}

            {drafts.length > 0 && (
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {drafts.map((d) => {
                  const m = media[d.id];
                  return (
                    <div key={d.id} className="card overflow-hidden p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                        {CHANNEL_LABEL[d.channel] ?? d.channel} · {d.format}
                      </p>
                      {m && (
                        <div className="relative mt-2 aspect-[4/5] w-full overflow-hidden rounded-lg border border-border">
                          {m.pending ? (
                            <div className="prism-shimmer absolute inset-0" aria-hidden>
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[10px] uppercase tracking-[0.2em] text-faint">
                                  {m.kind === "video" ? "filming" : "shooting"}
                                </span>
                              </div>
                            </div>
                          ) : m.kind === "video" ? (
                            <video src={m.url} autoPlay muted loop playsInline className="animate-in h-full w-full object-cover" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.url} alt="" className="animate-in h-full w-full object-cover" />
                          )}
                        </div>
                      )}
                      {d.title && <p className="mt-1.5 text-sm font-semibold leading-snug">{d.title}</p>}
                      <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-muted">{d.body}</p>
                      {d.hashtags && <p className="mt-1.5 line-clamp-2 text-[11px] text-faint">{d.hashtags}</p>}
                    </div>
                  );
                })}
              </div>
            )}
            {drafts.length >= 2 && (
              <p className="mt-3 text-xs text-faint">
                Same brand, three different platforms — notice each one is genuinely its own cut, not a copy-paste.
              </p>
            )}

            {weekDone !== null && (
              <div className="mt-8 flex flex-wrap gap-3">
                <button onClick={() => router.push("/calendar")} className="btn btn-primary">
                  Open your calendar →
                </button>
                <button onClick={() => router.push("/connections")} className="btn btn-secondary">
                  Connect your channels
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
