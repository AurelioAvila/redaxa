import assert from "node:assert/strict";

// Dummy values so the module-level Stripe client can be constructed. Nothing
// here reaches the network: fetch is mocked.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

const { syncSubscription } = await import("./stripe-webhook.js");

/**
 * One Stripe account bills PC Tweaker, the uninstaller and Redaxa, and Stripe
 * fans `customer.subscription.created` out to every endpoint subscribed to
 * that type. So this webhook sees other products' subscriptions as a matter
 * of routine, and has to be able to say which ones are not its own.
 *
 * It could not. `syncSubscription` skipped a subscription it could not link,
 * but returned nothing, and the handler announced the sale regardless: on
 * 2026-09-02 a PC Tweaker buyer was mailed a Redaxa welcome three seconds
 * after their own receipt, and the owner was told Redaxa had a new
 * subscriber it never had.
 *
 * What is pinned here is the answer syncSubscription gives back, because
 * that answer is now the thing gating the emails.
 */

function subscription(fields: Record<string, unknown>): never {
  return {
    id: "sub_test",
    customer: "cus_test",
    items: { data: [{ quantity: 1, price: { recurring: { interval: "month" } } }] },
    metadata: {},
    ...fields,
  } as never;
}

/** Mocks fetch, and records the Supabase calls made. */
async function withMockFetch<T>(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
  run: (calls: Array<{ url: string; method: string }>) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return impl(String(input), init);
  }) as typeof fetch;
  try { return await run(calls); } finally { globalThis.fetch = original; }
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

// Another product's subscription: no redaxa_user_id, and no billing_accounts
// row for its customer. It must come back null and write nothing.
await withMockFetch(async () => ok([]), async (calls) => {
  const result = await syncSubscription(subscription({ metadata: { product: "pctweaker", userId: "15" } }));

  assert.equal(result, null, "a PC Tweaker subscription is not a Redaxa one");
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0, "nothing may be written for a foreign subscription");
});

// Our own subscription, identified by the metadata we set at checkout.
await withMockFetch(async () => ok([]), async (calls) => {
  const result = await syncSubscription(subscription({ metadata: { redaxa_user_id: "user-1", plan: "personal" } }));

  assert.equal(result, "user-1");
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 1, "the account has to be updated");
});

// Our own subscription recognised by its customer id alone — the renewal
// path, where Stripe sends no metadata of ours.
await withMockFetch(async (url) => ok(url.includes("billing_accounts?user_id") ? [] : [{ user_id: "user-2" }]), async () => {
  const result = await syncSubscription(subscription({}));

  assert.equal(result, "user-2");
});

// The checkout path passes the user id in directly.
await withMockFetch(async () => ok([]), async () => {
  assert.equal(await syncSubscription(subscription({}), "user-3"), "user-3");
});

console.log("stripe-webhook.test.ts ok");
