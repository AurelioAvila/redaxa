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

export function clientIp(headers: Record<string, string | string[] | undefined> | undefined): string {
  const forwarded = headers?.["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value) return value.split(",")[0]?.trim() || "unknown";
  const real = headers?.["x-real-ip"];
  return (Array.isArray(real) ? real[0] : real) ?? "unknown";
}
