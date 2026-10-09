import { createHmac } from "node:crypto";

// Best-effort abuse guard for auth/checkout endpoints. This is in-memory per serverless
// instance: on Vercel it does NOT coordinate across concurrently warm instances, so it
// stops casual scripted abuse but is not a substitute for a shared store (Upstash/Vercel
// KV) under real attack traffic. Good enough for the current traffic level; revisit once
// there is a shared store available.
const buckets = new Map<string, { count: number; resetAt: number }>();
const maxTrackedKeys = 5000;

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > maxTrackedKeys) {
    for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(bucketKey);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

// Cross-instance authority: an atomic Postgres counter (rate_limit_hit RPC).
// The in-memory check above stays as the cheap first line; this one closes
// the "every warm instance has its own counter" hole. Deliberately fail-open:
// if the RPC is missing or the DB hiccups, the scan must still work — the
// in-memory guard still applies, and availability beats a perfect limit.
export async function rateLimitedShared(
  supabaseService: (path: string, init?: RequestInit) => Promise<Response>,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const response = await supabaseService("/rest/v1/rpc/rate_limit_hit", {
      method: "POST",
      body: JSON.stringify({ p_key: key, p_limit: limit, p_window_seconds: windowSeconds })
    });
    if (!response.ok) return false;
    return await response.json() === true;
  } catch {
    return false;
  }
}

/** A keyed hash of the caller's IP address, never the address itself: every
 *  use is a rate-limit key, and the shared counters live in the database. */
export function clientIp(headers: Record<string, string | string[] | undefined> | undefined): string {
  const forwarded = headers?.["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const real = headers?.["x-real-ip"];
  const address = (value ? value.split(",")[0]?.trim() : Array.isArray(real) ? real[0] : real) || "unknown";
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update(address).digest("base64url");
}
