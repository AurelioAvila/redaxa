import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
for (const [name, value] of Object.entries({ PERSONAL_MONTHLY: "price_pm", PERSONAL_YEARLY: "price_py", BUSINESS_MONTHLY: "price_bm", BUSINESS_YEARLY: "price_by" })) {
  process.env[`STRIPE_PRICE_${name}`] = value;
}

const { PROMO, PROMO_GRACE_SECONDS, couponId, percentOff, promoCheckout, promoState } = await import("./_promo.js");
const { stripe } = await import("./_billing.js");
const { default: billing } = await import("./billing.js");
const { promoLabel } = await import("./stripe-webhook.js");

const START = Date.parse(PROMO.startsAt);
const END = Date.parse(PROMO.endsAt);
const DURING = Date.parse("2026-10-31T20:00:00Z");
const ON = { PROMO_ID: PROMO.id };

// The offer ends at 23:59:59 on 6 November, Rome time (CET after 25 October).
const rome = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "medium" }).format(ms);
assert.equal(rome(END - 1000), "06/11/2026, 23:59:59");
assert.equal(rome(END), "07/11/2026, 00:00:00");

// Prices offered to the public, from the live Stripe Prices and every Redaxa
// Checkout Session since August (UTC). [from, until, cents]
const HISTORY: Record<string, [string, string | null, number][]> = {
  "personal:monthly": [["2026-08-11T18:37Z", null, 799]],
  "personal:yearly": [["2026-08-11T18:40Z", "2026-09-27T08:01Z", 7999], ["2026-09-27T08:01Z", null, 7990]],
  "business:monthly": [["2026-08-11T18:38Z", null, 1499]],
  "business:yearly": [["2026-08-11T18:39Z", "2026-09-27T08:00Z", 14999], ["2026-09-27T08:00Z", null, 14990]],
};
// The owner's rule: the highest whole-euro or ,99 amount at or under half the
// reference; from 100 euro, a multiple of 5.
function roundedHalf(reference: number): number {
  const half = reference / 2;
  if (half >= 10_000) return Math.floor(half / 500) * 500;
  return Math.max(Math.floor(half / 100) * 100, Math.floor((half - 99) / 100) * 100 + 99);
}
assert.deepEqual([799, 7990, 1499, 14990, 1900, 17000, 3900, 35000, 9900, 75000, 25000].map(roundedHalf), [399, 3900, 700, 7400, 900, 8500, 1900, 17500, 4900, 37500, 12500]);
const lowestBefore = (key: string, startMs: number) => Math.min(...HISTORY[key]
  .filter(([from, until]) => Date.parse(from) < startMs && (until === null || Date.parse(until) > startMs - 30 * 86_400_000))
  .map(([, , cents]) => cents));
for (const offer of PROMO.offers) {
  const key = `${offer.plan}:${offer.interval}`;
  // The reference may never be above the lowest price of the 30 days before any go-live moment.
  assert.equal(offer.reference, lowestBefore(key, START), key);
  for (let t = START; t < END; t += 3_600_000) assert.ok(offer.reference <= lowestBefore(key, t), `${key} at ${new Date(t).toISOString()}`);
  assert.equal(offer.price, roundedHalf(offer.reference), `${key} follows the price rule`);
  assert.ok(percentOff(offer.reference, offer.price) >= 50, key);
}
assert.deepEqual(PROMO.offers.map((o) => percentOff(o.reference, o.price)), [50, 51, 53, 50]);
assert.equal(percentOff(1000, 801), 19, "rounded down, never up");

// Simulated clock: nothing before the switch or the start, every offer during, nothing from the end.
assert.equal(promoState({}, DURING).status, "disabled", "off until PROMO_ID is set");
assert.equal(promoState({ PROMO_ID: "halloween-2025" }, DURING).status, "disabled", "a stale id enables nothing");
assert.equal(promoState({ ...ON, PROMO_DISABLED: "1" }, DURING).status, "disabled", "kill switch");
const scheduled = promoState(ON, START - 1);
assert.equal(scheduled.status, "scheduled");
assert.deepEqual(scheduled.offers, [], "no price is published before the start");
for (const now of [START, DURING, END - 1]) {
  const state = promoState(ON, now);
  assert.equal(state.status, "active");
  assert.equal(state.endsAt, PROMO.endsAt);
  assert.equal(state.serverTime, new Date(now).toISOString());
  assert.deepEqual(state.offers.find((o) => o.plan === "business" && o.interval === "monthly"),
    { plan: "business", interval: "monthly", currency: "eur", regular: 1499, reference: 1499, price: 700, percentOff: 53, perSeat: true, firstPeriodOnly: true });
  assert.equal(state.offers.length, 4);
}
for (const now of [END, END + 86_400_000, Date.parse("2027-10-31T12:00:00Z")]) {
  assert.deepEqual(promoState(ON, now), { serverTime: new Date(now).toISOString(), id: null, status: "disabled", startsAt: null, endsAt: null, offers: [] });
}

// Checkout: the plan's own coupon, one per Business seat count, only inside the window.
assert.equal(promoCheckout(ON, DURING, "personal", "monthly", 1)?.coupon, "halloween50-2026-redaxa-personal-monthly");
assert.equal(promoCheckout(ON, DURING, "personal", "yearly", 1)?.coupon, "halloween50-2026-redaxa-personal-yearly");
for (const seats of [1, 2, 3]) {
  assert.equal(promoCheckout(ON, DURING, "business", "yearly", seats)?.coupon, `halloween50-2026-redaxa-business-yearly-${seats}`);
  assert.equal(couponId({ plan: "business", interval: "monthly" }, seats), `halloween50-2026-redaxa-business-monthly-${seats}`);
}
for (const [plan, interval, seats] of [["personal", "monthly", 2], ["business", "monthly", 4], ["business", "monthly", 0], ["business", "yearly", 1.5], ["team", "monthly", 1], ["personal", "weekly", 1]] as const) {
  assert.equal(promoCheckout(ON, DURING, plan, interval, seats), null, `${plan} ${interval} ${seats}`);
}
for (const now of [START - 1, END, END + 7 * 86_400_000]) assert.equal(promoCheckout(ON, now, "personal", "monthly", 1), null);
assert.equal(promoCheckout({}, DURING, "personal", "monthly", 1), null);
// The checkout deadline never touches Stripe's 30 minutes or 24 hours, and no
// session outlives the end by more than the grace (plus Stripe's minute).
for (let now = START; now < END; now += 7 * 60_000) {
  const { expiresAt } = promoCheckout(ON, now, "business", "monthly", 2)!;
  const nowSeconds = Math.floor(now / 1000);
  const closes = expiresAt ?? nowSeconds + 24 * 60 * 60;
  if (expiresAt !== null) {
    assert.ok(expiresAt >= nowSeconds + PROMO_GRACE_SECONDS + 60, new Date(now).toISOString());
    assert.ok(expiresAt <= nowSeconds + 23.5 * 60 * 60, new Date(now).toISOString());
  }
  assert.ok(closes <= END / 1000 + PROMO_GRACE_SECONDS + 60, new Date(now).toISOString());
}
assert.equal(promoCheckout(ON, DURING, "personal", "monthly", 1)!.expiresAt, null, "Stripe's default far from the end");

// The handler: public GET, then the checkout parameters Stripe receives.
type Captured = Record<string, any>;
const calls: Captured[] = [];
(stripe.checkout.sessions as any).create = async (params: Captured) => { calls.push(params); return { url: "https://checkout.stripe.test/fixture" }; };
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/auth/v1/user")) return Response.json({ id: `user-${calls.length}-${Math.random()}`, email: "promo@example.test" });
  if (url.includes("reserve_billing_checkout")) return Response.json({ stripe_customer_id: "cus_fixture", has_used_trial: calls.length % 2 === 1, subscription_status: null, current_period_end: null, plan: null, stripe_subscription_id: null, seat_count: 1 });
  return Response.json({});
}) as typeof fetch;
function response() {
  return { statusCode: 0, headers: {} as Record<string, unknown>, body: undefined as unknown,
    setHeader(name: string, value: unknown) { this.headers[name.toLowerCase()] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; }, end() {} };
}
const realNow = Date.now;
async function at<T>(ms: number, run: () => Promise<T>): Promise<T> {
  Date.now = () => ms;
  try { return await run(); } finally { Date.now = realNow; }
}
async function checkout(body: Record<string, unknown>, now: number, environment: Record<string, string | undefined>) {
  Object.assign(process.env, environment);
  if (!environment.PROMO_ID) delete process.env.PROMO_ID;
  const res = response();
  await at(now, () => billing({ method: "POST", body, headers: { authorization: "Bearer fixture", "x-forwarded-for": `198.51.100.${calls.length}` } }, res as any));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return calls.at(-1)!;
}

process.env.PROMO_ID = PROMO.id;
const promoRes = response();
await billing({ method: "GET", query: { action: "promo" }, headers: { origin: "https://tauri.localhost" } }, promoRes as any);
assert.equal(promoRes.statusCode, 200);
assert.equal(promoRes.headers["cache-control"], "no-store");
assert.equal(promoRes.headers["access-control-allow-origin"], "https://tauri.localhost", "the Windows app can read it");
assert.equal(/price_|coupon|sk_test|cus_/.test(JSON.stringify(promoRes.body)), false, "no Stripe identifiers in public");

for (const [body, coupon] of [
  [{ plan: "personal", interval: "monthly" }, "halloween50-2026-redaxa-personal-monthly"],
  [{ plan: "personal", interval: "yearly" }, "halloween50-2026-redaxa-personal-yearly"],
  [{ plan: "business", interval: "monthly", seats: 3 }, "halloween50-2026-redaxa-business-monthly-3"],
  [{ plan: "business", interval: "yearly", seats: 2 }, "halloween50-2026-redaxa-business-yearly-2"],
] as const) {
  const during = await checkout(body, END - 3_600_000, ON);
  assert.deepEqual(during.discounts, [{ coupon }]);
  assert.equal(during.allow_promotion_codes, undefined, "Checkout refuses promotion codes with a discount");
  assert.equal(during.metadata.promo_id, PROMO.id);
  assert.equal(during.subscription_data.metadata.promo_id, PROMO.id);
  assert.equal(during.line_items[0].price.startsWith("price_"), true, "the base price never changes");
  assert.equal(during.expires_at, Math.floor(END / 1000), "an hour before the end, the session closes at the end");
  assert.equal((await checkout(body, DURING, ON)).expires_at, undefined, "Stripe's default far from the end");
  for (const [now, environment] of [[START - 1, ON], [END, ON], [DURING, {}], [DURING, { ...ON, PROMO_DISABLED: "1" }]] as const) {
    const outside = await checkout(body, now, environment);
    assert.equal(outside.discounts, undefined);
    assert.equal(outside.expires_at, undefined);
    assert.equal(outside.metadata.promo_id, undefined);
    assert.equal(outside.allow_promotion_codes, body.interval === "monthly");
  }
  delete process.env.PROMO_DISABLED;
}
globalThis.fetch = originalFetch;

// The welcome email says the first payment was discounted, and only then.
assert.equal(promoLabel("€7.99 / month", PROMO.id), "€7.99 / month (first payment discounted)");
assert.equal(promoLabel("€7.99 / month", undefined), "€7.99 / month");
assert.equal(promoLabel(null, PROMO.id), null);

console.log("_promo.test.ts ok");
