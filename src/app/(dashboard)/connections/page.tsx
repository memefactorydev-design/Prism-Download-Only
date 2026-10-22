import { redirect } from "next/navigation";
import { getConnectionStatuses, PER_USER_PROVIDERS } from "@/lib/connections";
import { getSessionUser } from "@/lib/auth";
import { ConnectionCard, type ProviderCardSpec } from "@/components/ConnectionCard";
import { EngineCard } from "@/components/EngineCard";
import { engineModeLockedByEnv, engineOverview, lastClaudeRateLimit } from "@/lib/llm";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

// The Phase 1 setup wizard: each card walks through creating the account/key
// from scratch (Guj starts with zero credentials), then validates and stores it.
const SPECS: ProviderCardSpec[] = [
  {
    provider: "anthropic",
    title: "Anthropic API key — optional, pay-per-token",
    blurb:
      "Only needed if you'd rather bill Anthropic's API than use a Claude Code or Codex sign-in (see the AI engine card above). When a key is connected it takes priority in Auto mode.",
    steps: [
      "Go to console.anthropic.com and sign in (create an account if you don't have one).",
      "Add billing under Settings → Billing — a small amount of credit is enough to start.",
      "Open API Keys and click Create Key. Name it prism-ai.",
      "Copy the key (it starts with sk-ant- and is shown only once) and paste it below.",
    ],
    fields: [{ key: "apiKey", label: "API key", placeholder: "sk-ant-…", secret: true }],
  },
  {
    provider: "gemini",
    title: "Google Gemini — live research, images & video",
    blurb:
      "Powers the named agents' live Google-grounded research, Nano Banana image generation and Veo video in the Ad Studio.",
    steps: [
      "Go to aistudio.google.com and sign in with a Google account.",
      "Click Get API key → Create API key (a free tier is included; billing unlocks higher limits and Veo).",
      "Copy the key and paste it below.",
    ],
    fields: [{ key: "apiKey", label: "API key", placeholder: "AIza…", secret: true }],
  },
  {
    provider: "postiz",
    title: "Postiz — posting core",
    blurb:
      "One integration that publishes to Instagram, Facebook, TikTok and LinkedIn. Postiz handles each platform's login.",
    steps: [
      "Create an account at postiz.com (paid cloud — or self-host the open-source version, in which case change the API URL below).",
      "Inside Postiz, add your channels: Instagram, your Facebook page, TikTok, LinkedIn and YouTube. Postiz walks you through each platform's own login/permission screens.",
      "Go to Postiz Settings and generate a Public API key.",
      "Paste the key below. Leave the URL as-is unless you self-host.",
    ],
    fields: [
      { key: "apiKey", label: "API key", secret: true },
      {
        key: "apiUrl",
        label: "API URL",
        defaultValue: "https://api.postiz.com/public/v1",
        hint: "only change if self-hosting",
      },
    ],
  },
  {
    provider: "meta",
    title: "Meta — ads + ad research",
    blurb:
      "Reads campaign performance/ROAS and powers Ad Library research. Campaign writes unlock after Meta App Review.",
    steps: [
      "Go to developers.facebook.com → My Apps → Create App. Choose the Business app type and link your business portfolio.",
      "In the app dashboard, open App settings → Basic and copy the App ID and App Secret.",
      "Add the Marketing API product to the app.",
      "Generate an access token: Tools → Graph API Explorer → select your app → add the ads_read permission → Generate Access Token. (Later, a System User token from Business Settings gives you a non-expiring one — fine to start with this.)",
      "Find your ad account ID in Ads Manager — the number after act_ in the URL.",
      "Honest heads-up: creating/editing campaigns needs ads_management + Meta App Review. The card will show that as locked until review passes — reading insights and Ad Library research work before then.",
    ],
    fields: [
      { key: "appId", label: "App ID" },
      { key: "appSecret", label: "App Secret", secret: true },
      { key: "accessToken", label: "Access token", secret: true },
      { key: "adAccountId", label: "Ad account ID", placeholder: "e.g. 1234567890 (without act_)" },
    ],
  },
  {
    provider: "googleads",
    title: "Google Ads — search campaigns + optimisation",
    blurb:
      "Reads campaign performance and conversion value, and lets the Google Ads manager agent propose budget/pause changes that execute only after your approval — on your own ad account.",
    steps: [
      "Developer token: sign in to (or create) a Google Ads MANAGER account at ads.google.com/home/tools/manager-accounts → Admin → API Center → apply for a token. A test token works instantly on test accounts; 'Basic access' (a short Google form) is needed for live accounts.",
      "OAuth client: console.cloud.google.com → create/select a project → enable the 'Google Ads API' → APIs & Services → Credentials → Create Credentials → OAuth client ID → application type 'Web application' → add https://developers.google.com/oauthplayground to Authorised redirect URIs. Copy the Client ID and Client Secret.",
      "Refresh token: open developers.google.com/oauthplayground → click the ⚙️ (top right) → tick 'Use your own OAuth credentials' and paste the Client ID/Secret → in Step 1 enter scope https://www.googleapis.com/auth/adwords → Authorise with the Google account that can access your Ads account → Step 2 'Exchange authorization code for tokens' → copy the Refresh token.",
      "Customer ID: the 10-digit number at the top right of ads.google.com (e.g. 123-456-7890 — dashes optional).",
      "If your access to that account goes VIA the manager account, also enter the manager's 10-digit ID as the Login customer ID; otherwise leave it blank.",
    ],
    fields: [
      { key: "developerToken", label: "Developer token", secret: true },
      { key: "clientId", label: "OAuth Client ID", placeholder: "…apps.googleusercontent.com" },
      { key: "clientSecret", label: "OAuth Client Secret", secret: true },
      { key: "refreshToken", label: "Refresh token", secret: true, placeholder: "1//…" },
      { key: "customerId", label: "Customer ID", placeholder: "123-456-7890" },
      { key: "loginCustomerId", label: "Login customer ID (manager account — optional)", placeholder: "leave blank unless using an MCC" },
    ],
  },
  {
    provider: "gsc",
    title: "Google Search Console — real search data",
    blurb:
      "Feeds the SEO/GEO audit with measured queries, clicks, CTR and positions from Google itself — no guessing. Read-only.",
    steps: [
      "In console.cloud.google.com (any project) enable the 'Google Search Console API'.",
      "IAM & Admin → Service Accounts → Create service account (name it prism-gsc) → done. Open it → Keys → Add key → JSON — a key file downloads.",
      "In search.google.com/search-console → your property → Settings → Users and permissions → Add user → paste the service account's email (…@…iam.gserviceaccount.com) with Full permission.",
      "Paste the ENTIRE contents of the downloaded JSON file below, plus the property exactly as Search Console shows it (sc-domain:example.com for domain properties, or https://example.com/ for URL-prefix ones).",
    ],
    fields: [
      { key: "serviceAccountJson", label: "Service account key (full JSON)", secret: true, placeholder: '{ "type": "service_account", … }' },
      { key: "siteUrl", label: "Property", placeholder: "sc-domain:example.com" },
    ],
  },
  {
    provider: "smtp",
    title: "Email (SMTP) — newsletters",
    blurb:
      "Sends your newsletters through your own email provider (Google Workspace, Brevo, Resend SMTP, Mailgun…). Every email carries a one-click unsubscribe automatically.",
    steps: [
      "Get SMTP credentials from your email provider (e.g. Brevo → SMTP & API; Google Workspace → app password; Resend → SMTP).",
      "Use port 587 (STARTTLS) unless your provider says 465 (TLS).",
      "Set the From address to a mailbox on your own domain — newsletters from free addresses land in spam.",
    ],
    fields: [
      { key: "host", label: "SMTP host", placeholder: "smtp-relay.brevo.com" },
      { key: "port", label: "Port", defaultValue: "587" },
      { key: "user", label: "Username" },
      { key: "password", label: "Password", secret: true },
      { key: "fromEmail", label: "From email", placeholder: "hello@yourbrand.com" },
      { key: "fromName", label: "From name (optional)", placeholder: "Your Brand" },
    ],
  },
  {
    provider: "apify",
    title: "Apify — TikTok & Instagram trend research",
    blurb:
      "Powers Studio's viral trend research. Heads-up: this scrapes TikTok/Instagram (subject to their Terms of Service) and Apify runs cost credits. We only analyse public patterns/metadata — it never re-uses other creators' videos.",
    steps: [
      "Create an account at apify.com (there's a free tier to start).",
      "In Apify Store, add the scraper actors you want — e.g. a TikTok scraper and an Instagram scraper — so your account can run them.",
      "Open Settings → Integrations (API) and copy your Personal API token.",
      "Paste it below. If your actors differ from the defaults, set APIFY_TIKTOK_ACTOR / APIFY_INSTAGRAM_ACTOR in .env.",
    ],
    fields: [{ key: "apiToken", label: "API token", placeholder: "apify_api_…", secret: true }],
  },
  {
    provider: "elevenlabs",
    title: "ElevenLabs — voice, music & sound effects",
    blurb:
      "Powers Studio's voice-over mode (an agent writes the script, ElevenLabs narrates it with word-perfect caption timing), Prism Score music composition (original, commercially-cleared tracks sized to your cut), and the generated sound-effects library used in edits. Usage bills your ElevenLabs quota.",
    steps: [
      "Sign in at elevenlabs.io and open your profile (top-right).",
      "Create an API key under API Keys and copy it.",
      "Optionally pick a default voice at elevenlabs.io/voices and paste its voice ID below.",
    ],
    fields: [
      { key: "apiKey", label: "API key", secret: true, placeholder: "sk_…" },
      {
        key: "voiceId",
        label: "Default voice ID (optional)",
        placeholder: "e.g. 21m00Tcm4TlvDq8ikWAM",
        hint: "Leave empty to use a stock narrator; you can pick per video in Studio.",
      },
    ],
  },
  {
    provider: "pexels",
    title: "Pexels — free stock photos & videos",
    blurb:
      "Adds a 'Find stock' search to the media library: free photos and b-roll clips imported straight into your assets, usable in Director cuts, Ad Studio grounding and calendar posts. Attribution to creators is appreciated per Pexels' terms.",
    steps: [
      "Go to pexels.com/api and sign in (free).",
      "Copy your API key and paste it below.",
    ],
    fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "563492ad…" }],
  },
  {
    provider: "fal",
    title: "fal.ai — Seedance video engine",
    blurb:
      "The PRIMARY video engine: ByteDance Seedance renders ad clips and film segments (text-to-video, or animate your real photos), up to 15s per render — longer ads are stitched from segments. Veo (Gemini) is the automatic backup. Usage bills your fal.ai balance.",
    steps: [
      "Sign in at fal.ai and open Dashboard → Keys.",
      "Create a key and paste it below (it looks like id:secret).",
      "Add credit at fal.ai/dashboard/billing — generation fails loudly on an empty balance.",
    ],
    fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "xxxxxxxx-…:…" }],
  },
  {
    provider: "wordpress",
    title: "WordPress — publish live",
    blurb:
      "Lets the SEO/content tools and the website builder push pages, blog posts and FAQ content live to your WordPress site. Every live push is approval-gated.",
    steps: [
      "In WordPress, go to Users → Profile → Application Passwords.",
      "Add a new application password named 'Prism AI' and copy the generated password.",
      "Enter your site URL, your WordPress username, and that application password below.",
    ],
    fields: [
      { key: "siteUrl", label: "Site URL", placeholder: "https://www.yourbusiness.com" },
      { key: "username", label: "Username" },
      { key: "appPassword", label: "Application password", secret: true, hint: "not your login password" },
    ],
  },
  {
    provider: "ftp",
    title: "FTP / SFTP — publish static sites",
    blurb:
      "Uploads built sites and landing pages (static HTML) to any host over SFTP or FTP. Used by the website builder's Publish and by SEO content pushes. Live pushes are approval-gated.",
    steps: [
      "Get your host's SFTP/FTP credentials (host, port, username, password).",
      "Set the base directory files should upload to (e.g. /public_html or /public_html/landing).",
      "Set the public URL that maps to that directory (e.g. https://www.yourbusiness.com).",
    ],
    fields: [
      { key: "protocol", label: "Protocol", options: ["sftp", "ftp"], defaultValue: "sftp" },
      { key: "host", label: "Host", placeholder: "ftp.yourhost.com" },
      { key: "port", label: "Port", defaultValue: "22", hint: "22 for SFTP, 21 for FTP" },
      { key: "user", label: "Username" },
      { key: "password", label: "Password", secret: true },
      { key: "baseDir", label: "Base directory", defaultValue: "/public_html", placeholder: "/public_html" },
      { key: "publicBaseUrl", label: "Public URL", placeholder: "https://www.yourbusiness.com" },
    ],
  },
];

export default async function ConnectionsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const isAdmin = user.role === "admin";
  const [statuses, overview] = await Promise.all([getConnectionStatuses(user.id, user.role), engineOverview()]);
  // Members bring their OWN social accounts (Postiz + Meta) — the rest of the
  // stack is the workspace's and stays admin-managed.
  const specs = isAdmin ? SPECS : SPECS.filter((s) => PER_USER_PROVIDERS.has(s.provider));
  return (
    <div>
      <PageHeader
        title="Connections"
        subtitle={
          isAdmin
            ? "Connect the services Prism runs on. Keys are validated against the live API, then stored encrypted (AES-256-GCM) in the local database — never in code or git."
            : "Connect your own Postiz and Meta accounts — everything you schedule, publish or analyse uses YOUR channels and ad account, nobody else's. Keys are validated live, then stored encrypted."
        }
      />
      {/* P4.6 — the numbered path in. Connect in order; everything already
          works in generate-only mode, connecting is what makes it publish. */}
      {!isAdmin && (() => {
        const steps: { provider: string; label: string; what: string }[] = [
          { provider: "postiz", label: "Publishing", what: "posts go out to your channels" },
          { provider: "meta", label: "Meta ads", what: "ad performance + the ads manager" },
          { provider: "googleads", label: "Google Ads", what: "the second ad network" },
          { provider: "gsc", label: "Search Console", what: "real search data in SEO audits" },
          { provider: "smtp", label: "Email", what: "newsletters send from your address" },
        ];
        const done = steps.filter((st) => statuses.find((x) => x.provider === st.provider)?.status === "connected");
        const next = steps.find((st) => statuses.find((x) => x.provider === st.provider)?.status !== "connected");
        return (
          <div className="card mb-6 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-foreground">Your setup — {done.length}/{steps.length} connected</h2>
              {next && <span className="text-xs text-accent">Next up: {next.label}</span>}
            </div>
            <ol className="mt-3 space-y-1.5">
              {steps.map((st, i) => {
                const ok = done.some((d) => d.provider === st.provider);
                return (
                  <li key={st.provider} className={`flex items-center gap-2.5 text-sm ${ok ? "text-muted line-through decoration-border" : "text-foreground"}`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${ok ? "bg-emerald-500/20 text-emerald-500" : "border border-border text-faint"}`}>
                      {ok ? "✓" : i + 1}
                    </span>
                    <span className="font-medium">{st.label}</span>
                    <span className="text-xs text-faint">— {st.what}</span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-xs text-faint">
              Nothing here blocks you: every feature works in generate-only mode until its channel is connected.
            </p>
          </div>
        );
      })()}

      <div className="space-y-6">
        {isAdmin && (
          <EngineCard
            overview={overview}
            lockedByEnv={engineModeLockedByEnv()}
            rateLimit={lastClaudeRateLimit()}
            isAdmin={isAdmin}
          />
        )}
        {specs.map((spec) => (
          <ConnectionCard
            key={spec.provider}
            spec={spec}
            status={statuses.find((s) => s.provider === spec.provider)!}
          />
        ))}
      </div>
    </div>
  );
}
