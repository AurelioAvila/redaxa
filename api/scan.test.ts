import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
const { default: handler } = await import("./scan.js");

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
      headers: { ...(userId ? { authorization: "Bearer fixture" } : {}), "x-forwarded-for": ip } }, response);
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

// A visitor's shared counter is keyed by a hash, never the raw IP address.
assert.equal((await scan("", null, "10.9.8.7")).code, 200);
const visitorKey = storedKeys.find((key) => key.startsWith("scan:anon:"));
assert.ok(visitorKey && !visitorKey.includes("10.9.8.7"), "rate-limit keys hold no IP address");


// Activity reads: an API key gets its own account's events, never the team's
// (team activity names members by email); a signed-in owner gets both.
async function activity(authorization: string, scope?: string) {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: paid, email: "owner@example.test" });
    if (url.includes("/api_keys?key_hash=")) return Response.json([{ id: "key-1", user_id: paid }]);
    if (url.includes("/auth/v1/admin/users/")) return Response.json({ email: "teammate@example.test" });
    if (url.includes("/organization_members?")) return Response.json([{ organization_id: "org-1", user_id: paid, role: "owner" }]);
    if (url.includes("/scan_events?")) return Response.json([{ created_at: "2026-10-20T10:00:00Z", application: "web", finding_kinds: [], finding_categories: [], finding_count: 0, action: "allow", user_id: "teammate" }], { headers: { "content-range": "0-0/1" } });
    return Response.json([]);
  }) as typeof fetch;
  const response = { code: 0, payload: undefined as unknown, setHeader() {}, status(code: number) { this.code = code; return this; }, json(value: unknown) { this.payload = value; }, end() {} };
  try { await handler({ method: "GET", query: scope ? { scope } : {}, headers: { authorization } } as never, response); } finally { globalThis.fetch = savedFetch; }
  return response;
}
assert.equal((await activity("Bearer psk_live_fixture")).code, 200, "a key reads its own activity");
assert.equal((await activity("Bearer psk_live_fixture", "org")).code, 401, "a key never reads team activity");
const team = await activity("Bearer session-token", "org");
assert.equal(team.code, 200);
assert.equal((team.payload as { events: { member: string }[] }).events[0].member, "teammate@example.test");

console.log("Scan: free daily allowance for plan-less accounts, per-account counting and unlimited subscribers and bounded custom terms passed.");
