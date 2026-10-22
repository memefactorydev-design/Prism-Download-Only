// Multi-user dashboard sessions: token = "v2.<expiryMs>.<userId>.<role>.<sig>",
// where sig = HMAC-SHA256("<expiryMs>.<userId>.<role>") keyed by
// TOKEN_ENCRYPTION_KEY. The role rides in the token so the proxy can gate
// admin-only paths without a DB call; sensitive route handlers additionally
// re-check the user in the DB (src/lib/auth.ts). Web Crypto only — this module
// must run in both proxy.ts and route handlers.

export const SESSION_COOKIE = "prism_session";
export const SESSION_MAX_AGE_SECS = 60 * 60 * 24 * 7; // 7 days

// ─── Open access (no login) ───────────────────────────────────────────────────
// OPEN_ACCESS=1 turns the login screen off: every visitor is signed in as the
// built-in owner account (admin). Meant for local evaluation and for private
// team servers that sit behind their own network/VPN — never expose an
// open-access instance to the public internet.
export const OPEN_USER_ID = "open-access-owner";

export function isOpenAccess(): boolean {
  return process.env.OPEN_ACCESS === "1";
}

export interface SessionClaims {
  userId: string;
  role: "admin" | "member";
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function keyMaterial(): Promise<ArrayBuffer> {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (hex && hex.length === 64) return hexToBytes(hex) as unknown as ArrayBuffer;
  if (isOpenAccess()) {
    // No key configured but nobody is being authenticated anyway: derive a
    // stable key so sessions still verify across restarts. `npm run setup`
    // writes a real random key into .env, so this path is a safety net.
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode("prism-open-access-session"));
  }
  throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte hex string. See .env.example.");
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    await keyMaterial(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(buf: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(buf)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSessionToken(userId: string, role: "admin" | "member", nowMs: number): Promise<string> {
  const expiry = String(nowMs + SESSION_MAX_AGE_SECS * 1000);
  const payload = `${expiry}.${userId}.${role}`;
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `v2.${payload}.${toBase64Url(sig)}`;
}

export async function verifySessionToken(token: string, nowMs: number): Promise<SessionClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v2") return null;
  const [, expiry, userId, role, sig] = parts;
  if (!/^\d+$/.test(expiry) || Number(expiry) < nowMs) return null;
  if (role !== "admin" && role !== "member") return null;
  const key = await getHmacKey();
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${expiry}.${userId}.${role}`));
  if (toBase64Url(expected) !== sig) return null;
  return { userId, role };
}
