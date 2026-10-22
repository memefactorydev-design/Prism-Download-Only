// Google auth helpers shared by the Search Console and Google Ads clients.
// Two flavours: service-account JWT (GSC — headless, no OAuth dance) and
// OAuth refresh-token exchange (Google Ads — the API requires user OAuth).
// No SDK: both are small, stable HTTP flows, signed with node:crypto.

import { createSign } from "node:crypto";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Access token for a service account (RS256-signed JWT → token exchange). */
export async function serviceAccountToken(sa: ServiceAccount, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(sa.private_key, "base64url");
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Google rejected the service account: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json.access_token;
}

/** Access token from an OAuth client + refresh token (Google Ads). */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Google OAuth refresh failed: ${json.error_description ?? json.error ?? `HTTP ${res.status}`} — regenerate the refresh token.`
    );
  }
  return json.access_token;
}

/** Parse a pasted service-account JSON key, failing with a human message. */
export function parseServiceAccount(raw: string): ServiceAccount {
  let sa: Partial<ServiceAccount>;
  try {
    sa = JSON.parse(raw) as Partial<ServiceAccount>;
  } catch {
    throw new Error("That isn't valid JSON — paste the entire service-account key file.");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("The JSON is missing client_email/private_key — paste the FULL service-account key file.");
  }
  return sa as ServiceAccount;
}
