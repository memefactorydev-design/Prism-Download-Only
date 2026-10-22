// Connection management: the single place credentials are validated, encrypted,
// stored and read back. Secrets live in the DB as one AES-256-GCM-encrypted JSON
// blob per provider (Connection.encryptedToken); .env values act as a fallback
// for anyone who prefers filling .env directly. Secrets never leave the server —
// status endpoints return metadata only.

import { db } from "@/lib/db";
import { encryptToken, decryptToken } from "@/lib/crypto";
import { track } from "@/lib/events";

export type Provider =
  | "anthropic"
  | "gemini"
  | "postiz"
  | "meta"
  | "googleads"
  | "gsc"
  | "smtp"
  | "apify"
  | "elevenlabs"
  | "pexels"
  | "fal"
  | "wordpress"
  | "ftp";
export const PROVIDERS: Provider[] = [
  "anthropic",
  "gemini",
  "postiz",
  "meta",
  "googleads",
  "gsc",
  "smtp",
  "apify",
  "elevenlabs",
  "pexels",
  "fal",
  "wordpress",
  "ftp",
];

export interface AnthropicSecrets {
  apiKey: string;
}
export interface GeminiSecrets {
  apiKey: string;
}
export interface PostizSecrets {
  apiKey: string;
  apiUrl: string;
}
export interface MetaSecrets {
  appId: string;
  appSecret: string;
  accessToken: string;
  adAccountId: string;
}
export interface GoogleAdsSecrets {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string; // the ad account to manage, digits only
  loginCustomerId?: string; // MCC/manager account id, when access goes via one
}
export interface GscSecrets {
  serviceAccountJson: string; // full service-account key file, pasted
  siteUrl: string; // GSC property: "https://example.com/" or "sc-domain:example.com"
}
export interface SmtpSecrets {
  host: string;
  port: number;
  user: string;
  password: string;
  fromEmail: string;
  fromName?: string;
  secure?: boolean; // true = TLS (465); false = STARTTLS (587)
}
export interface ApifySecrets {
  apiToken: string;
}
export interface ElevenlabsSecrets {
  apiKey: string;
  voiceId?: string; // default voice for Studio voice-overs (optional)
}
export interface PexelsSecrets {
  apiKey: string;
}
export interface FalSecrets {
  apiKey: string; // fal.ai key ("id:secret" format)
}
export interface WordpressSecrets {
  siteUrl: string;
  username: string;
  appPassword: string; // WordPress application password
}
export interface FtpSecrets {
  protocol: "ftp" | "sftp";
  host: string;
  port: number;
  user: string;
  password: string;
  baseDir: string; // where files are uploaded, e.g. /public_html
  publicBaseUrl: string; // public URL that maps to baseDir, e.g. https://site.com
}
export type SecretsMap = {
  anthropic: AnthropicSecrets;
  gemini: GeminiSecrets;
  postiz: PostizSecrets;
  meta: MetaSecrets;
  googleads: GoogleAdsSecrets;
  gsc: GscSecrets;
  smtp: SmtpSecrets;
  apify: ApifySecrets;
  elevenlabs: ElevenlabsSecrets;
  pexels: PexelsSecrets;
  fal: FalSecrets;
  wordpress: WordpressSecrets;
  ftp: FtpSecrets;
};

export interface ConnectionStatus {
  provider: Provider;
  status: "disconnected" | "connected" | "error";
  // Provider-specific, non-secret facts for the dashboard (account name, scopes,
  // connected Postiz channels, App Review state, warnings...).
  metadata: Record<string, unknown> | null;
  updatedAt: string | null;
}

// Account-shaped providers are PER-USER: each beta tester connects their own,
// so nothing they approve, spend or send touches the business's accounts.
// "" is the shared workspace scope (the owner's connections + engine stack).
export const PER_USER_PROVIDERS: ReadonlySet<Provider> = new Set([
  "postiz",
  "meta",
  "googleads",
  "gsc",
  "smtp",
] as Provider[]);

/** The Connection.userId scope a given user reads for a provider. */
export function connectionScope(provider: Provider, userId: string, role: string): string {
  if (!PER_USER_PROVIDERS.has(provider)) return "";
  return role === "admin" ? "" : userId; // admins share the workspace accounts
}

export async function getConnectionStatuses(scopeUserId = "", role = "admin"): Promise<ConnectionStatus[]> {
  const rows = await db.connection.findMany();
  return PROVIDERS.map((provider) => {
    const scope = connectionScope(provider, scopeUserId, role);
    const row = rows.find((r) => r.provider === provider && r.userId === scope);
    if (row && row.encryptedToken) {
      return {
        provider,
        status: row.status as ConnectionStatus["status"],
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        updatedAt: row.updatedAt.toISOString(),
      };
    }
    // No DB row — report env-var fallback as connected-via-env so the page is honest.
    const env = scope === "" ? secretsFromEnv(provider) : null;
    return {
      provider,
      status: env ? "connected" : "disconnected",
      metadata: env ? { source: "env" } : null,
      updatedAt: null,
    };
  });
}

/** Decrypted secrets for internal server use. DB first, .env fallback, null if neither. */
export async function getSecrets<P extends Provider>(provider: P, scopeUserId = ""): Promise<SecretsMap[P] | null> {
  const scope = PER_USER_PROVIDERS.has(provider) ? scopeUserId : "";
  const row = await db.connection.findUnique({ where: { provider_userId: { provider, userId: scope } } });
  if (row?.encryptedToken) {
    return JSON.parse(decryptToken(row.encryptedToken)) as SecretsMap[P];
  }
  // .env fallback belongs to the shared workspace only — never to a user scope.
  return scope === "" ? secretsFromEnv(provider) : null;
}

function secretsFromEnv<P extends Provider>(provider: P): SecretsMap[P] | null {
  const e = process.env;
  switch (provider) {
    case "anthropic":
      return e.ANTHROPIC_API_KEY ? ({ apiKey: e.ANTHROPIC_API_KEY } as SecretsMap[P]) : null;
    case "gemini":
      return e.GEMINI_API_KEY ? ({ apiKey: e.GEMINI_API_KEY } as SecretsMap[P]) : null;
    case "postiz":
      return e.POSTIZ_API_KEY
        ? ({
            apiKey: e.POSTIZ_API_KEY,
            apiUrl: e.POSTIZ_API_URL ?? "https://api.postiz.com/public/v1",
          } as SecretsMap[P])
        : null;
    case "meta":
      return e.META_ACCESS_TOKEN && e.META_APP_ID
        ? ({
            appId: e.META_APP_ID,
            appSecret: e.META_APP_SECRET ?? "",
            accessToken: e.META_ACCESS_TOKEN,
            adAccountId: e.META_AD_ACCOUNT_ID ?? "",
          } as SecretsMap[P])
        : null;
    case "googleads":
      return e.GOOGLE_ADS_DEVELOPER_TOKEN && e.GOOGLE_ADS_REFRESH_TOKEN
        ? ({
            developerToken: e.GOOGLE_ADS_DEVELOPER_TOKEN,
            clientId: e.GOOGLE_ADS_CLIENT_ID ?? "",
            clientSecret: e.GOOGLE_ADS_CLIENT_SECRET ?? "",
            refreshToken: e.GOOGLE_ADS_REFRESH_TOKEN,
            customerId: e.GOOGLE_ADS_CUSTOMER_ID ?? "",
            loginCustomerId: e.GOOGLE_ADS_LOGIN_CUSTOMER_ID || undefined,
          } as SecretsMap[P])
        : null;
    case "gsc":
      return e.GSC_SERVICE_ACCOUNT_JSON && e.GSC_SITE_URL
        ? ({ serviceAccountJson: e.GSC_SERVICE_ACCOUNT_JSON, siteUrl: e.GSC_SITE_URL } as SecretsMap[P])
        : null;
    case "smtp":
      return e.SMTP_HOST && e.SMTP_USER
        ? ({
            host: e.SMTP_HOST,
            port: Number(e.SMTP_PORT || 587),
            user: e.SMTP_USER,
            password: e.SMTP_PASSWORD ?? "",
            fromEmail: e.SMTP_FROM_EMAIL ?? e.SMTP_USER,
            fromName: e.SMTP_FROM_NAME || undefined,
            secure: e.SMTP_SECURE === "1",
          } as SecretsMap[P])
        : null;
    case "apify":
      return e.APIFY_TOKEN ? ({ apiToken: e.APIFY_TOKEN } as SecretsMap[P]) : null;
    case "elevenlabs":
      return e.ELEVENLABS_API_KEY
        ? ({ apiKey: e.ELEVENLABS_API_KEY, voiceId: e.ELEVENLABS_VOICE_ID || undefined } as SecretsMap[P])
        : null;
    case "pexels":
      return e.PEXELS_API_KEY ? ({ apiKey: e.PEXELS_API_KEY } as SecretsMap[P]) : null;
    case "fal":
      return e.FAL_KEY ? ({ apiKey: e.FAL_KEY } as SecretsMap[P]) : null;
    case "wordpress":
      return e.WORDPRESS_SITE_URL && e.WORDPRESS_USERNAME && e.WORDPRESS_APP_PASSWORD
        ? ({
            siteUrl: e.WORDPRESS_SITE_URL,
            username: e.WORDPRESS_USERNAME,
            appPassword: e.WORDPRESS_APP_PASSWORD,
          } as SecretsMap[P])
        : null;
    case "ftp":
      return e.FTP_HOST && e.FTP_USER
        ? ({
            protocol: (e.FTP_PROTOCOL === "ftp" ? "ftp" : "sftp"),
            host: e.FTP_HOST,
            port: Number(e.FTP_PORT || (e.FTP_PROTOCOL === "ftp" ? 21 : 22)),
            user: e.FTP_USER,
            password: e.FTP_PASSWORD ?? "",
            baseDir: e.FTP_BASE_DIR ?? "/",
            publicBaseUrl: e.FTP_PUBLIC_BASE_URL ?? "",
          } as SecretsMap[P])
        : null;
    default:
      return null;
  }
}

/**
 * Validate credentials against the live API, then store them encrypted.
 * Throws with a human-readable message if validation fails — nothing is stored.
 */
export async function connectProvider<P extends Provider>(
  provider: P,
  secrets: SecretsMap[P],
  scopeUserId = ""
): Promise<ConnectionStatus> {
  track("connection_added", scopeUserId, { provider });
  const scope = PER_USER_PROVIDERS.has(provider) ? scopeUserId : "";
  const metadata = await validate(provider, secrets);
  const row = await db.connection.upsert({
    where: { provider_userId: { provider, userId: scope } },
    create: {
      provider,
      userId: scope,
      status: "connected",
      encryptedToken: encryptToken(JSON.stringify(secrets)),
      metadata: JSON.stringify(metadata),
    },
    update: {
      status: "connected",
      encryptedToken: encryptToken(JSON.stringify(secrets)),
      metadata: JSON.stringify(metadata),
    },
  });
  return { provider, status: "connected", metadata, updatedAt: row.updatedAt.toISOString() };
}

export async function disconnectProvider(provider: Provider, scopeUserId = ""): Promise<void> {
  const scope = PER_USER_PROVIDERS.has(provider) ? scopeUserId : "";
  await db.connection.deleteMany({ where: { provider, userId: scope } });
}

// ─── Per-provider live validation ───────────────────────────────────────────

async function validate(provider: Provider, secrets: unknown): Promise<Record<string, unknown>> {
  switch (provider) {
    case "anthropic":
      return validateAnthropic(secrets as AnthropicSecrets);
    case "gemini":
      return validateGemini(secrets as GeminiSecrets);
    case "postiz":
      return validatePostiz(secrets as PostizSecrets);
    case "meta":
      return validateMeta(secrets as MetaSecrets);
    case "googleads":
      return validateGoogleAds(secrets as GoogleAdsSecrets);
    case "gsc":
      return validateGsc(secrets as GscSecrets);
    case "smtp":
      return validateSmtp(secrets as SmtpSecrets);
    case "apify":
      return validateApify(secrets as ApifySecrets);
    case "elevenlabs":
      return validateElevenlabs(secrets as ElevenlabsSecrets);
    case "pexels":
      return validatePexels(secrets as PexelsSecrets);
    case "fal":
      return validateFal(secrets as FalSecrets);
    case "wordpress":
      return validateWordpress(secrets as WordpressSecrets);
    case "ftp":
      return validateFtp(secrets as FtpSecrets);
  }
}

async function validateWordpress({ siteUrl, username, appPassword }: WordpressSecrets): Promise<Record<string, unknown>> {
  if (!siteUrl?.trim() || !username?.trim() || !appPassword?.trim()) {
    throw new Error("Site URL, username and an application password are required (WordPress → Users → Profile → Application Passwords).");
  }
  const base = siteUrl.trim().replace(/\/$/, "");
  const auth = Buffer.from(`${username.trim()}:${appPassword.trim().replace(/\s+/g, "")}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(`${base}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`Could not reach ${base}/wp-json — check the site URL and that the WordPress REST API is enabled.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("WordPress rejected these credentials. Use an Application Password (not your login password) and the matching username.");
  }
  if (!res.ok) throw new Error(`WordPress REST API returned HTTP ${res.status} at ${base}.`);
  const me = (await res.json()) as { name?: string; slug?: string; capabilities?: Record<string, boolean> };
  const canPublish = me.capabilities?.publish_pages || me.capabilities?.publish_posts;
  return { siteUrl: base, name: me.name, canPublish: Boolean(canPublish) };
}

async function validateFtp(s: FtpSecrets): Promise<Record<string, unknown>> {
  if (!s.host?.trim() || !s.user?.trim()) throw new Error("Host and username are required.");
  const baseDir = s.baseDir?.trim() || "/";
  const port = Number(s.port) || (s.protocol === "ftp" ? 21 : 22);
  if (s.protocol === "sftp") {
    const { default: SftpClient } = await import("ssh2-sftp-client");
    const client = new SftpClient();
    try {
      await client.connect({ host: s.host.trim(), port, username: s.user.trim(), password: s.password });
      const list = await client.list(baseDir);
      return { protocol: "sftp", host: s.host.trim(), entries: list.length };
    } catch (err) {
      throw new Error(`SFTP connection failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.end().catch(() => {});
    }
  }
  const { Client } = await import("basic-ftp");
  const client = new Client(15_000);
  try {
    await client.access({ host: s.host.trim(), port, user: s.user.trim(), password: s.password, secure: false });
    const list = await client.list(baseDir);
    return { protocol: "ftp", host: s.host.trim(), entries: list.length };
  } catch (err) {
    throw new Error(`FTP connection failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    client.close();
  }
}

async function validateElevenlabs({ apiKey, voiceId }: ElevenlabsSecrets): Promise<Record<string, unknown>> {
  if (!apiKey?.trim()) throw new Error("Paste your ElevenLabs API key (elevenlabs.io → Profile → API keys).");
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey.trim() },
  });
  if (res.status === 401) throw new Error("ElevenLabs rejected this key — generate a fresh one in your ElevenLabs profile.");
  if (!res.ok) throw new Error(`ElevenLabs API returned HTTP ${res.status}.`);
  const data = (await res.json()) as { voices?: { voice_id: string; name?: string }[] };
  const voices = data.voices ?? [];
  if (voiceId?.trim() && !voices.some((v) => v.voice_id === voiceId.trim())) {
    throw new Error(`Voice id "${voiceId.trim()}" isn't in this account's voice list — pick one from elevenlabs.io/voices.`);
  }
  return {
    voices: voices.length,
    sampleVoices: voices.slice(0, 5).map((v) => v.name ?? v.voice_id),
    defaultVoice: voiceId?.trim() || null,
  };
}

async function validatePexels({ apiKey }: PexelsSecrets): Promise<Record<string, unknown>> {
  if (!apiKey?.trim()) throw new Error("Paste your Pexels API key (pexels.com/api).");
  const res = await fetch("https://api.pexels.com/v1/search?query=kitchen&per_page=1", {
    headers: { Authorization: apiKey.trim() },
  });
  if (res.status === 401) throw new Error("Pexels rejected this key — check it at pexels.com/api.");
  if (!res.ok) throw new Error(`Pexels API returned HTTP ${res.status}.`);
  return { ok: true };
}

async function validateFal({ apiKey }: FalSecrets): Promise<Record<string, unknown>> {
  if (!apiKey?.trim()) throw new Error("Paste your fal.ai key (fal.ai/dashboard/keys — 'id:secret' format).");
  // Deliberately invalid payload: a 422 proves the key authenticates WITHOUT
  // spending credits; fal returns 401 for bad keys and a 403 "Exhausted balance"
  // for valid-but-unfunded accounts (still a working connection — flag it).
  const res = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { Authorization: `Key ${apiKey.trim()}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) throw new Error("fal.ai rejected this key — generate a fresh one at fal.ai/dashboard/keys.");
  const body = await res.text().catch(() => "");
  if (res.status === 403 && body.includes("Exhausted balance")) {
    return { ok: true, warning: "Key is valid but the fal.ai balance is empty — top up at fal.ai/dashboard/billing." };
  }
  if (res.status === 422 || res.ok) return { ok: true };
  throw new Error(`fal.ai returned HTTP ${res.status}: ${body.slice(0, 150)}`);
}

async function validateApify({ apiToken }: ApifySecrets): Promise<Record<string, unknown>> {
  if (!apiToken?.trim()) throw new Error("Paste your Apify API token (Apify Console → Settings → Integrations).");
  const res = await fetch(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(apiToken.trim())}`);
  if (res.status === 401) throw new Error("Apify rejected this token — copy it again from Apify Console → Settings → Integrations.");
  if (!res.ok) throw new Error(`Apify API returned HTTP ${res.status}. Try again shortly.`);
  const data = (await res.json()) as { data?: { username?: string; plan?: { id?: string } } };
  return { username: data.data?.username, plan: data.data?.plan?.id };
}

async function validateAnthropic({ apiKey }: AnthropicSecrets): Promise<Record<string, unknown>> {
  if (!apiKey?.trim()) throw new Error("Paste your Anthropic API key (starts with sk-ant-).");
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": apiKey.trim(), "anthropic-version": "2023-06-01" },
  });
  if (res.status === 401) throw new Error("Anthropic rejected this key. Check it was copied in full from console.anthropic.com.");
  if (!res.ok) throw new Error(`Anthropic API returned HTTP ${res.status}. Try again in a minute.`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return { modelsAvailable: data.data?.length ?? 0 };
}

async function validateGemini({ apiKey }: GeminiSecrets): Promise<Record<string, unknown>> {
  if (!apiKey?.trim()) throw new Error("Paste your Gemini API key (from aistudio.google.com → Get API key).");
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the word OK" }] }] }),
    }
  );
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new Error("Google rejected this key. Check it was copied in full from AI Studio.");
  }
  if (!res.ok) throw new Error(`Gemini API returned HTTP ${res.status}. Try again in a minute.`);
  const data = (await res.json()) as { candidates?: unknown[] };
  return { textPing: Boolean(data.candidates?.length), imagesAndVideo: "Nano Banana + Veo unlocked" };
}

async function validatePostiz({ apiKey, apiUrl }: PostizSecrets): Promise<Record<string, unknown>> {
  if (!apiKey?.trim()) throw new Error("Paste your Postiz API key (Postiz → Settings → API).");
  const base = (apiUrl?.trim() || "https://api.postiz.com/public/v1").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/integrations`, { headers: { Authorization: apiKey.trim() } });
  } catch {
    throw new Error(`Could not reach ${base} — check the API URL (only change it if self-hosting).`);
  }
  if (res.status === 401 || res.status === 403) throw new Error("Postiz rejected this key. Generate a fresh one in Postiz → Settings → API.");
  if (!res.ok) throw new Error(`Postiz API returned HTTP ${res.status}.`);
  const json = (await res.json()) as unknown;
  const list = Array.isArray(json) ? json : ((json as Record<string, unknown>).integrations as unknown[]) ?? [];
  const channels = (list as Record<string, unknown>[]).map((i) => ({
    id: String(i.id ?? ""),
    platform: String(i.identifier ?? i.platform ?? "unknown"),
    name: String(i.name ?? ""),
  }));
  // The channels this app posts to — show which are still missing in Postiz.
  // Each entry lists the identifier substrings that count as connected (gbp is
  // "gmb"/"google-my-business" on the Postiz side).
  const wanted: [string, string[]][] = [
    ["instagram", ["instagram"]],
    ["facebook", ["facebook"]],
    ["tiktok", ["tiktok"]],
    ["linkedin", ["linkedin"]],
    ["youtube", ["youtube"]],
    ["pinterest", ["pinterest"]],
    ["gbp", ["gmb", "google"]],
  ];
  return {
    channels,
    missingChannels: wanted
      .filter(([, aliases]) => !channels.some((c) => aliases.some((a) => c.platform.toLowerCase().includes(a))))
      .map(([name]) => name),
  };
}

async function validateGoogleAds(s: GoogleAdsSecrets): Promise<Record<string, unknown>> {
  const { refreshAccessToken } = await import("@/lib/google-auth");
  if (!s.developerToken?.trim()) throw new Error("Developer token is required (Google Ads Manager account → Admin → API Center).");
  if (!s.clientId?.trim() || !s.clientSecret?.trim()) throw new Error("OAuth Client ID and Client Secret are required (Google Cloud Console → Credentials).");
  if (!s.refreshToken?.trim()) throw new Error("Refresh token is required — generate one with the OAuth playground steps on this card.");
  const cid = s.customerId?.replace(/-/g, "").trim();
  if (!cid) throw new Error("Customer ID is required — the 10-digit account number from Google Ads (top right).");

  const token = await refreshAccessToken(s.clientId.trim(), s.clientSecret.trim(), s.refreshToken.trim());
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": s.developerToken.trim(),
    "Content-Type": "application/json",
  };
  if (s.loginCustomerId?.trim()) headers["login-customer-id"] = s.loginCustomerId.replace(/-/g, "").trim();

  const res = await fetch(`https://googleads.googleapis.com/v21/customers/${cid}/googleAds:search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: "SELECT customer.descriptive_name, customer.currency_code, customer.test_account FROM customer LIMIT 1",
    }),
  });
  const json = (await res.json()) as {
    results?: { customer?: { descriptiveName?: string; currencyCode?: string; testAccount?: boolean } }[];
    error?: { message?: string; details?: { errors?: { message?: string }[] }[] };
  };
  if (!res.ok) {
    const detail = json.error?.details?.[0]?.errors?.[0]?.message ?? json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Google Ads API rejected the connection: ${detail}`);
  }
  const customer = json.results?.[0]?.customer;
  return {
    accountName: customer?.descriptiveName ?? cid,
    currency: customer?.currencyCode,
    testAccount: Boolean(customer?.testAccount),
    warnings: customer?.testAccount ? ["This is a TEST account — spend and results are simulated."] : [],
  };
}

async function validateGsc(s: GscSecrets): Promise<Record<string, unknown>> {
  const { parseServiceAccount, serviceAccountToken } = await import("@/lib/google-auth");
  if (!s.siteUrl?.trim()) throw new Error("Site URL is required — exactly as it appears in Search Console (e.g. sc-domain:example.com or https://example.com/).");
  const sa = parseServiceAccount(s.serviceAccountJson ?? "");
  const token = await serviceAccountToken(sa, "https://www.googleapis.com/auth/webmasters.readonly");
  const site = s.siteUrl.trim();
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 403 || res.status === 404) {
    throw new Error(
      `The service account can't see "${site}". In Search Console → Settings → Users, add ${sa.client_email} as a user (Full permission), then retry.`
    );
  }
  if (!res.ok) throw new Error(`Search Console API returned HTTP ${res.status}.`);
  const data = (await res.json()) as { permissionLevel?: string };
  return { siteUrl: site, serviceAccount: sa.client_email, permission: data.permissionLevel };
}

async function validateSmtp(s: SmtpSecrets): Promise<Record<string, unknown>> {
  if (!s.host?.trim() || !s.user?.trim()) throw new Error("SMTP host and username are required.");
  if (!s.fromEmail?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.fromEmail.trim())) {
    throw new Error("A valid From email address is required.");
  }
  const nodemailer = (await import("nodemailer")).default;
  const port = Number(s.port) || 587;
  const transport = nodemailer.createTransport({
    host: s.host.trim(),
    port,
    secure: s.secure ?? port === 465,
    auth: { user: s.user.trim(), pass: s.password },
  });
  try {
    await transport.verify();
  } catch (err) {
    throw new Error(`SMTP connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { host: s.host.trim(), fromEmail: s.fromEmail.trim(), fromName: s.fromName || null };
}

const GRAPH = "https://graph.facebook.com/v23.0";

async function validateMeta(secrets: MetaSecrets): Promise<Record<string, unknown>> {
  const { appId, appSecret, accessToken, adAccountId } = secrets;
  if (!accessToken?.trim()) throw new Error("Paste your Meta access token (see the steps above the form).");
  if (!appId?.trim() || !appSecret?.trim()) throw new Error("App ID and App Secret are required (Meta app dashboard → Settings → Basic).");

  const meRes = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(accessToken.trim())}`);
  const me = (await meRes.json()) as { id?: string; name?: string; error?: { message: string } };
  if (!meRes.ok || me.error) {
    throw new Error(`Meta rejected this token: ${me.error?.message ?? `HTTP ${meRes.status}`}`);
  }

  const warnings: string[] = [];
  let scopes: string[] = [];
  const permsRes = await fetch(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(accessToken.trim())}`);
  if (permsRes.ok) {
    const perms = (await permsRes.json()) as { data?: { permission: string; status: string }[] };
    scopes = (perms.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
  } else {
    warnings.push("Could not read token permissions — capability flags below may be incomplete.");
  }

  let adAccount: Record<string, unknown> | null = null;
  if (adAccountId?.trim()) {
    const acctRes = await fetch(
      `${GRAPH}/act_${adAccountId.trim().replace(/^act_/, "")}?fields=name,account_status&access_token=${encodeURIComponent(accessToken.trim())}`
    );
    const acct = (await acctRes.json()) as { name?: string; account_status?: number; error?: { message: string } };
    if (acctRes.ok && !acct.error) {
      adAccount = { name: acct.name, accountStatus: acct.account_status };
    } else {
      warnings.push(`Ad account ${adAccountId} not readable with this token yet: ${acct.error?.message ?? `HTTP ${acctRes.status}`}`);
    }
  } else {
    warnings.push("No ad account ID provided — ROAS reading (Phase 4) will need it.");
  }

  const adsWrite = scopes.includes("ads_management");
  return {
    accountName: me.name,
    scopes,
    adAccount,
    capabilities: {
      adLibraryResearch: true, // public API, works with any valid app token
      insightsRead: adsWrite || scopes.includes("ads_read"),
      adsWrite,
    },
    // Honest status the dashboard surfaces: campaign writes stay locked until App Review.
    adsWriteState: adsWrite ? "unlocked" : "pending_app_review",
    warnings,
  };
}
