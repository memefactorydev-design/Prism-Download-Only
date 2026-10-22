// Login brute-force protection. In-memory on purpose: the app runs as ONE
// long-lived `next start` process per instance, so a Map survives requests;
// a restart resetting the counters is acceptable (attackers don't control
// restarts, and the limiter exists to make guessing uneconomical, not to be
// a perfect ledger). If the app ever goes multi-process, move this to the DB.

interface Bucket {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000; // counting window
const MAX_FAILURES = 5; // per key per window
const LOCKOUT_MS = 15 * 60 * 1000; // lock after the limit is hit
const MAX_BUCKETS = 10_000; // memory bound under distributed attacks

function bucketFor(key: string, now: number): Bucket {
  let b = buckets.get(key);
  if (!b || (now - b.windowStart > WINDOW_MS && b.lockedUntil <= now)) {
    b = { failures: 0, windowStart: now, lockedUntil: 0 };
    buckets.set(key, b);
  }
  return b;
}

/** Minutes (rounded up, min 1) until a locked key frees — for the error message. */
function minutesLeft(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 60_000));
}

/**
 * Gate a login attempt for an email + IP pair. Returns null when allowed, or a
 * human-readable refusal when either key is locked out.
 */
export function checkLoginAllowed(email: string, ip: string, now = Date.now()): string | null {
  for (const key of [`e:${email}`, `ip:${ip}`]) {
    const b = buckets.get(key);
    if (b && b.lockedUntil > now) {
      return `Too many failed sign-in attempts. Try again in ${minutesLeft(b.lockedUntil, now)} minute(s).`;
    }
  }
  return null;
}

/** Record a failed attempt; locks the email and/or IP once the limit is hit. */
export function recordLoginFailure(email: string, ip: string, now = Date.now()): void {
  // Bounded memory: under a distributed attack, reject new tracking rather than OOM.
  if (buckets.size > MAX_BUCKETS) {
    for (const [key, b] of buckets) {
      if (b.lockedUntil <= now && now - b.windowStart > WINDOW_MS) buckets.delete(key);
    }
  }
  // The IP bucket gets more headroom than the email bucket: one office/NAT IP
  // can host several legitimate users mistyping at once.
  for (const [key, limit] of [
    [`e:${email}`, MAX_FAILURES],
    [`ip:${ip}`, MAX_FAILURES * 4],
  ] as const) {
    const b = bucketFor(key, now);
    b.failures++;
    if (b.failures >= limit) b.lockedUntil = now + LOCKOUT_MS;
  }
}

/** A successful login clears that email's counter (the IP counter ages out). */
export function recordLoginSuccess(email: string): void {
  buckets.delete(`e:${email}`);
}

/** Client IP as seen through the reverse proxy (Caddy sets X-Forwarded-For). */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}
