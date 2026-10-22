// THE single Apify runner. Intel (src/lib/intel.ts), Studio trend research
// (src/lib/apify.ts) and template research all shell through here, so there is
// exactly one place that owns how an actor is invoked (sync run, dataset items,
// auth, timeouts). Per-platform actor choice and input shapes stay with the
// callers — this module only runs what it's given and returns the items.

import { getSecrets } from "@/lib/connections";

const API_BASE = "https://api.apify.com/v2";

export interface RunActorOptions {
  /** Actor-side timeout in seconds (Apify kills the run after this). */
  timeoutSec?: number;
  /** Actor memory in MB. */
  memoryMb?: number;
}

/**
 * Run an Apify actor synchronously and return its dataset items.
 * Throws `Apify <status>: <detail>` on HTTP errors so callers can map specific
 * statuses (401 bad token, 404 unknown actor, 403 not-rented) to friendly
 * messages — never a silent empty result.
 */
export async function runApifyActor(
  actor: string,
  input: Record<string, unknown>,
  opts: RunActorOptions = {}
): Promise<unknown[]> {
  const secrets = await getSecrets("apify");
  if (!secrets?.apiToken) throw new Error("Apify isn't connected yet — see the Connections page.");
  const timeout = opts.timeoutSec ?? 240;
  const memory = opts.memoryMb ?? 1024;
  const res = await fetch(
    `${API_BASE}/acts/${actor.replace("/", "~")}/run-sync-get-dataset-items?timeout=${timeout}&memory=${memory}&format=json&clean=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secrets.apiToken}` },
      body: JSON.stringify(input),
      // Give the client a little longer than the actor so Apify's own timeout
      // error (not a local abort) is what surfaces.
      signal: AbortSignal.timeout((timeout + 20) * 1000),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Apify ${res.status}: ${detail.slice(0, 300)}`);
  }
  const items = (await res.json()) as unknown;
  return Array.isArray(items) ? items : [];
}
