import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
const { default: handler } = await import("./scan.js");
const { storedRateLimitKey } = await import("./_rateLimit.js");

const storedKeys: string[] = [];
async function scan(userId: string, plan: Record<string, unknown> | null, ip: string, body: Record<string, unknown> = { text: "Email marco.rossi@acme.com about the invoice", application: "web" }) {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: userId, email: "user@example.test" });
    if (url.includes("/rpc/rate_limit_hit")) { storedKeys.push(JSON.parse(String(init?.body)).p_key); return Response.json(false, { status: 404 }); } // shared limiter fails open
    if (url.includes("/billing_accounts?")) return Response.json(plan ? [plan] : []);
    if (init?.method && init.method !== "GET") return Response.json([]);
    return Response.json([]);
  }) as typeof fetch;
  const response = {
    code: 200, payload: undefined as unknown,
    setHeader() {}, status(code: number) { this.code = code; return this; },
    json(value: unknown) { this.payload = value; }, end() {}
  };
  try {
    await handler({ method: "POST", body,
      headers: { authorization: "Bearer fixture", "x-forwarded-for": ip } }, response);
  } finally { globalThis.fetch = savedFetch; }
  return response;
}

// An account without a plan gets the visitor allowance, counted per account.
const free = "00000000-0000-0000-0000-0000000000f1";
for (let i = 0; i < 5; i++) assert.equal((await scan(free, null, `10.0.0.${i}`)).code, 200, `free check ${i + 1}`);
const sixth = await scan(free, null, "10.0.1.1");
assert.equal(sixth.code, 402);
assert.deepEqual(sixth.payload, { error: "TRIAL_REQUIRED" });

// A different account keeps its own allowance.
assert.equal((await scan("00000000-0000-0000-0000-0000000000f2", null, "10.0.0.1")).code, 200);

// A subscriber is not held to the daily allowance.
const paid = "00000000-0000-0000-0000-0000000000a1";
const plan = { user_id: paid, plan: "pro", subscription_status: "active", current_period_end: new Date(Date.now() + 864e5).toISOString() };
for (let i = 0; i < 7; i++) assert.equal((await scan(paid, plan, `10.0.2.${i}`)).code, 200, `paid check ${i + 1}`);

// An oversized custom term is cut to the saved-term limit instead of failing
// the whole check while compiling it into a regular expression.
const long = await scan(paid, plan, "10.0.3.1", { text: "Project Falcon launch notes", options: { customTerms: ["Project Falcon" + " ".repeat(40_000) + "x"] } });
assert.equal(long.code, 200);
assert.equal((long.payload as { findings: { kind: string }[] }).findings.filter((f) => f.kind === "custom").length, 1);

// Shared counters never store a raw IP address or account id.
assert.ok(storedKeys.length > 0);
for (const key of storedKeys) assert.match(key, /^scan:(free|user):[A-Za-z0-9_-]{43}$/);
assert.equal(storedRateLimitKey("scan:anon:2001:db8::1").startsWith("scan:anon:"), true);
assert.equal(storedRateLimitKey("scan:anon:2001:db8::1").includes("2001"), false);

console.log("Scan: free daily allowance for plan-less accounts, per-account counting and unlimited subscribers and bounded custom terms passed.");
