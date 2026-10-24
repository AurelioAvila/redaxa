import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

// Dummy values so the module-level clients can be built. Nothing here reaches
// the network: fetch (Supabase) and the Stripe methods used are replaced.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";
process.env.STRIPE_PRICE_PERSONAL_MONTHLY = "price_pro_monthly_fixture";
process.env.STRIPE_PRICE_PERSONAL_YEARLY = "price_pro_yearly_fixture";
process.env.STRIPE_PRICE_BUSINESS_MONTHLY = "price_biz_monthly_fixture";
process.env.STRIPE_PRICE_BUSINESS_YEARLY = "price_biz_yearly_fixture";
process.env.REDAXA_MAIL_FROM = "Redaxa <noreply@example.test>";
const sinkDir = mkdtempSync(join(tmpdir(), "redaxa-trial-mail-"));
process.env.EMAIL_SINK = "1";
process.env.EMAIL_SINK_DIR = sinkDir;
delete process.env.PROMO_ID;
delete process.env.TRIAL_ENABLED;

const { stripe } = await import("./_billing.js");
const trial = await import("./_trial.js");
const { trialMail, TRIAL_WORDS } = await import("./_trial-email.js");
const { default: billing, sendTrialReminders } = await import("./billing.js");
const { default: webhook, syncSubscription } = await import("./stripe-webhook.js");
const { default: account } = await import("./account.js");

// --- One trial per mailbox: the same Gmail inbox written differently is one person.
assert.equal(trial.normalizeEmail("  Mario.Rossi+redaxa@GoogleMail.com "), "mariorossi@gmail.com");
assert.equal(trial.normalizeEmail("ann.lee+x@example.com"), "ann.lee@example.com", "dots count outside Gmail");
assert.equal(await trial.emailHash("m.ario.rossi@gmail.com"), await trial.emailHash("mariorossi+again@googlemail.com"));
assert.match(await trial.emailHash("a@b.c"), /^[0-9a-f]{64}$/);

// --- States the apps draw; anything unknown reads as blocked, never as Pro.
assert.deepEqual(trial.stateOf("trialing"), { state: "trialing", blockedReason: "none" });
assert.deepEqual(trial.stateOf("past_due"), { state: "blocked", blockedReason: "payment_failed" });
assert.deepEqual(trial.stateOf("unpaid"), { state: "blocked", blockedReason: "payment_failed" });
assert.deepEqual(trial.stateOf("canceled"), { state: "blocked", blockedReason: "canceled" });
assert.deepEqual(trial.stateOf("trial_rejected"), { state: "blocked", blockedReason: "trial_already_used" });
assert.deepEqual(trial.stateOf(null), { state: "none", blockedReason: "none" });
// A refused or ended subscription never overwrites the one that runs.
const running = { stripe_subscription_id: "sub_running", subscription_status: "trialing" };
assert.equal(trial.ownsAccount(running, { id: "sub_second", status: "trial_rejected" }), false);
assert.equal(trial.ownsAccount(running, { id: "sub_old", status: "canceled" }), false);
assert.equal(trial.ownsAccount(running, { id: "sub_running", status: "canceled" }), true);
assert.equal(trial.ownsAccount({ stripe_subscription_id: "sub_old", subscription_status: "canceled" }, { id: "sub_new", status: "trialing" }), true);
assert.equal(trial.ownsAccount(null, { id: "sub_new", status: "trial_rejected" }), true);

// --- Fakes for Supabase (REST) and Stripe.
type Row = Record<string, unknown>;
const db = {
  accounts: new Map<string, Row>(),
  claims: [] as Row[],
  users: new Map<string, string>(),
  calls: [] as Array<{ method: string; url: string; body?: Row }>,
  locked: false,
  refusal: null as string | null,
  trialTableMissing: false,
};
function resetDb(): void { db.accounts.clear(); db.claims = []; db.users.clear(); db.calls = []; }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) as Row : undefined;
  db.calls.push({ method, url, body });
  const user = (id: string) => ({ id, email: db.users.get(id) });
  if (url.endsWith("/auth/v1/user")) {
    const id = String((init?.headers as Record<string, string>)?.Authorization ?? "").replace(/^Bearer /, "");
    return db.users.has(id) ? json(user(id)) : json({}, 401);
  }
  const admin = /\/auth\/v1\/admin\/users\/([^/?]+)/.exec(url);
  if (admin) return db.users.has(decodeURIComponent(admin[1])) ? json(user(decodeURIComponent(admin[1]))) : json({}, 404);
  if (url.includes("/rpc/claim_stripe_event")) return json("claimed");
  if (url.includes("/rpc/complete_stripe_event")) return json(null);
  if (url.includes("/rpc/reserve_billing_checkout")) {
    if (db.locked) { db.locked = false; return json({ message: "A checkout session is already being prepared" }, 400); }
    if (db.refusal) { const message = db.refusal; db.refusal = null; return json({ message }, 400); }
    const id = String(body?.p_user_id);
    const row = db.accounts.get(id) ?? { user_id: id, stripe_customer_id: "cus_fixture", has_used_trial: false, subscription_status: null };
    db.accounts.set(id, row);
    return json(row);
  }
  if (url.includes("/rpc/redaxa_trial_available") && db.trialTableMissing) return json({ message: "function not found" }, 404);
  if (url.includes("/rpc/redaxa_trial_available")) return json(!db.claims.some((c) => c.user_id === body?.p_user_id || c.email_hash === body?.p_email_hash));
  if (url.includes("/rpc/claim_redaxa_trial")) {
    const clash = db.claims.find((c) => c.subscription_id !== body?.p_subscription_id
      && (c.user_id === body?.p_user_id || c.email_hash === body?.p_email_hash || (body?.p_card_fingerprint && c.card_fingerprint === body?.p_card_fingerprint)));
    if (!clash && !db.claims.some((c) => c.subscription_id === body?.p_subscription_id)) {
      db.claims.push({ subscription_id: body?.p_subscription_id, user_id: body?.p_user_id, email_hash: body?.p_email_hash, card_fingerprint: body?.p_card_fingerprint, trial_end: body?.p_trial_end, reminded_for: null, created_at: new Date((Number(new Date(String(body?.p_trial_end))) - 3 * 86_400_000)).toISOString() });
    }
    return json(db.claims.some((c) => c.subscription_id === body?.p_subscription_id));
  }
  if (url.includes("/rest/v1/redaxa_trial_claims")) {
    if (method === "PATCH") {
      const id = decodeURIComponent(/subscription_id=eq\.([^&]+)/.exec(url)![1]);
      Object.assign(db.claims.find((c) => c.subscription_id === id)!, body);
      return new Response(null, { status: 204 });
    }
    const byUser = /user_id=eq.([^&]+)/.exec(url);
    if (byUser) return json(db.claims.filter((c) => c.user_id === decodeURIComponent(byUser[1])));
    return json(db.claims.filter((c) => c.reminded_for === null));
  }
  if (url.includes("/rest/v1/billing_accounts")) {
    const byUser = /user_id=eq\.([^&]+)/.exec(url);
    const byCustomer = /stripe_customer_id=eq\.([^&]+)/.exec(url);
    if (method === "PATCH" && byUser) {
      const id = decodeURIComponent(byUser[1]);
      db.accounts.set(id, { ...(db.accounts.get(id) ?? { user_id: id }), ...body });
      return new Response(null, { status: 204 });
    }
    if (byUser) { const row = db.accounts.get(decodeURIComponent(byUser[1])); return json(row ? [row] : []); }
    if (byCustomer) return json([...db.accounts.values()].filter((r) => r.stripe_customer_id === decodeURIComponent(byCustomer[1])).map((r) => ({ user_id: r.user_id })));
  }
  if (url.includes("/rest/v1/")) return json([]);
  throw new Error(`unexpected fetch ${method} ${url}`);
}) as typeof fetch;

const sessions: Row[] = [];
const expired: string[] = [];
const cancelled: Array<{ id: string; comment?: string }> = [];
const subscriptions = new Map<string, Row>();
const s = stripe as any;
s.checkout.sessions.create = async (params: Row) => { sessions.push(params); return { url: "https://checkout.stripe.test/fixture" }; };
s.customers.create = async () => ({ id: "cus_fixture" });
s.checkout.sessions.list = async () => ({ data: [{ id: "cs_mine", metadata: { redaxa_user_id: "user-a" } }, { id: "cs_other", metadata: { redaxa_user_id: "someone-else" } }] });
s.checkout.sessions.expire = async (id: string) => { expired.push(id); return {}; };
s.customers.retrieve = async () => ({ id: "cus_fixture", email: "giulia@example.test", name: "Giulia Rossi" });
s.paymentMethods.retrieve = async (id: string) => ({ id, card: { fingerprint: `fp_${id}` } });
s.subscriptions.retrieve = async (id: string) => subscriptions.get(id);
s.subscriptions.cancel = async (id: string, params: { cancellation_details?: { comment?: string } }) => {
  cancelled.push({ id, comment: params.cancellation_details?.comment });
  const sub = subscriptions.get(id)!;
  Object.assign(sub, { status: "canceled", cancellation_details: { comment: params.cancellation_details?.comment }, ended_at: Math.floor(Date.now() / 1000) });
  return sub;
};
s.invoices.createPreview = async () => ({ amount_due: 487, currency: "eur" });
s.invoices.retrieve = async () => ({ payments: { data: [{ payment: { payment_intent: { status: "requires_payment_method", last_payment_error: { code: "card_declined", decline_code: "insufficient_funds" } } } }] } });
const prices: Record<string, Row> = {
  price_pro_monthly_fixture: { active: true, unit_amount: 799, currency: "eur", recurring: { interval: "month" }, tax_behavior: "exclusive" },
  price_pro_yearly_fixture: { active: true, unit_amount: 7990, currency: "eur", recurring: { interval: "year" }, tax_behavior: "exclusive" },
  price_biz_monthly_fixture: { active: true, unit_amount: 1499, currency: "eur", recurring: { interval: "month" }, tax_behavior: "exclusive" },
  price_biz_yearly_fixture: { active: false, unit_amount: 14990, currency: "eur", recurring: { interval: "year" }, tax_behavior: "exclusive" },
};
let priceReads = 0;
s.prices.retrieve = async (id: string) => { priceReads += 1; return prices[id]; };

function response() {
  return { statusCode: 0, headers: {} as Record<string, unknown>, body: undefined as any,
    setHeader(name: string, value: unknown) { this.headers[name.toLowerCase()] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; }, end() {} };
}
let ip = 0;
const DESKTOP = "https://tauri.localhost";
async function checkout(userId: string, body: Row, expected = 200, origin?: string) {
  const res = response();
  await billing({ method: "POST", body, headers: { authorization: `Bearer ${userId}`, "x-forwarded-for": `198.51.100.${ip++ % 250}`, ...(origin ? { origin } : {}) } }, res as any);
  assert.equal(res.statusCode, expected, JSON.stringify(res.body));
  return { res, params: res.statusCode === 200 ? sessions.at(-1)! as any : null };
}
function newUser(id: string, email = `${id}@example.test`, accountRow?: Row) {
  db.users.set(id, email);
  if (accountRow) db.accounts.set(id, { user_id: id, stripe_customer_id: "cus_fixture", has_used_trial: false, subscription_status: null, ...accountRow });
  return id;
}

// --- Switch off: no choice is offered. A checkout without one still carries
// the trial for an eligible account: three days, or seven for the Windows app
// 0.5.5 and older, which promises seven (desktop origin, no `language`). Always
// one per person: unpoliced, a new address and the same card bought another
// trial every time.
resetDb();
{
  const id = newUser("user-legacy");
  const { res, params } = await checkout(id, { plan: "personal", interval: "monthly" }, 200, DESKTOP);
  assert.equal(params.subscription_data.trial_period_days, 7);
  assert.equal(params.subscription_data.metadata.trial, "7d", "the webhook claims it like any policed trial");
  assert.equal(params.payment_method_collection, "always");
  assert.equal(params.metadata.lang, undefined);
  assert.equal(res.body.trial, true);
  assert.equal(res.body.trialDays, 7);
  // Every newer client without the choice: the same three days as everywhere else.
  for (const [who, body, origin] of [
    ["web page, offer unread", { plan: "personal", interval: "monthly", language: "it" }, "https://redaxa.getcertsprint.com"],
    ["Windows app 0.6.x, offer unread", { plan: "personal", interval: "monthly", language: "en" }, DESKTOP],
    ["request shaped like the old app, not from it", { plan: "personal", interval: "monthly" }, "https://redaxa.getcertsprint.com"],
    ["no origin at all", { plan: "business", interval: "monthly", seats: 2 }, undefined],
  ] as const) {
    const fresh = newUser(`user-auto-${who.replace(/\W+/g, "-")}`);
    const auto = await checkout(fresh, body, 200, origin);
    assert.equal(auto.params.subscription_data.trial_period_days, 3, who);
    assert.equal(auto.params.subscription_data.metadata.trial, "3d", who);
    assert.equal(auto.params.payment_method_collection, "always", who);
    assert.deepEqual(auto.params.subscription_data.trial_settings, { end_behavior: { missing_payment_method: "cancel" } }, who);
    assert.equal(auto.res.body.trialDays, 3, who);
  }
  db.claims.push({ subscription_id: "sub_legacy", user_id: id, email_hash: await trial.emailHash("user-legacy@example.test"), card_fingerprint: "fp_legacy", trial_end: null, reminded_for: null });
  const again = newUser("user-legacy-again", "user-legacy+2@example.test");
  assert.equal((await checkout(again, { plan: "personal", interval: "monthly" }, 200, DESKTOP)).params.subscription_data.trial_period_days, undefined, "switch off: the same mailbox gets no second week");
  assert.equal((await checkout(again, { plan: "personal", interval: "monthly", language: "en" })).params.subscription_data.trial_period_days, undefined, "nor a second trial from a newer client");
  newUser("user-subscribed-before", undefined, { has_used_trial: true });
  assert.equal((await checkout("user-subscribed-before", { plan: "personal", interval: "yearly" })).params.subscription_data.trial_period_days, undefined);
  const refused = await checkout(id, { plan: "personal", interval: "monthly", start_trial: true }, 409);
  assert.equal(refused.res.body.code, "trial_unavailable");
  const now = await checkout(id, { plan: "personal", interval: "monthly", start_trial: false });
  assert.equal(now.params.subscription_data.trial_period_days, undefined, "Subscribe now never carries a trial");
  await checkout(id, { plan: "personal", interval: "monthly", start_trial: "yes" }, 400);
  // If the trial table cannot be read, an old client still buys, just without the week.
  db.trialTableMissing = true;
  const unreadable = newUser("user-legacy-unreadable");
  assert.equal((await checkout(unreadable, { plan: "personal", interval: "monthly" }, 200, DESKTOP)).params.subscription_data.trial_period_days, undefined);
  assert.equal((await checkout(unreadable, { plan: "personal", interval: "monthly", language: "en" })).params.subscription_data.trial_period_days, undefined);
  db.trialTableMissing = false;
}

// --- Switch on: the customer chooses, the server grants.
process.env.TRIAL_ENABLED = "true";
resetDb();
{
  const id = newUser("user-a", "giulia.rossi@gmail.com");
  const { res, params } = await checkout(id, { plan: "business", interval: "monthly", seats: 2, start_trial: true, language: "it" });
  assert.equal(res.body.trial, true);
  assert.equal(res.body.trialDays, 3);
  assert.equal(params.subscription_data.trial_period_days, 3);
  assert.equal(params.payment_method_collection, "always");
  assert.deepEqual(params.subscription_data.trial_settings, { end_behavior: { missing_payment_method: "cancel" } });
  assert.equal(params.subscription_data.metadata.trial, "3d");
  assert.equal(params.metadata.lang, "it");
  assert.equal(params.line_items[0].quantity, 2);
  const direct = await checkout(id, { plan: "personal", interval: "yearly", start_trial: false });
  assert.equal(direct.params.subscription_data.trial_period_days, undefined);
  assert.equal(direct.params.subscription_data.metadata.trial, undefined);
  assert.equal(direct.params.payment_method_collection, undefined, "Subscribe now: an ordinary subscription, charged at once");
  assert.equal(direct.res.body.trial, false);
  // Changing one's mind with a checkout still open replaces it; old clients keep the wait.
  db.locked = true;
  const again = await checkout(id, { plan: "personal", interval: "monthly", start_trial: true });
  assert.equal(again.params.subscription_data.trial_period_days, 3);
  assert.deepEqual(expired, ["cs_mine"], "only this account's open checkout is closed");
  db.locked = true;
  await checkout(id, { plan: "personal", interval: "monthly" }, 429);
  db.locked = false;
  // An unpaid, paused or incomplete subscription is settled in Manage billing, never doubled.
  const opened = sessions.length;
  db.refusal = "The existing subscription needs attention in billing management";
  const unpaid = await checkout(id, { plan: "personal", interval: "monthly", start_trial: false }, 409);
  assert.equal(unpaid.res.body.code, "manage_billing");
  assert.equal(sessions.length, opened, "no second checkout session");
  // Windows app 0.5.5 and older: seven days, under the same rule.
  const legacy = await checkout(id, { plan: "personal", interval: "monthly" }, 200, DESKTOP);
  assert.equal(legacy.params.subscription_data.trial_period_days, 7);
  assert.equal(legacy.params.subscription_data.metadata.trial, "7d");
  // A page that could not read the offer sends no choice: three days, like the button it replaces.
  const fallback = await checkout(id, { plan: "personal", interval: "yearly", language: "de" }, 200, DESKTOP);
  assert.equal(fallback.params.subscription_data.trial_period_days, 3);
  assert.equal(fallback.params.subscription_data.metadata.trial, "3d");
  assert.equal(fallback.params.metadata.lang, "de");
  // Another account on the same Gmail inbox, once the first trial is claimed.
  db.claims.push({ subscription_id: "sub_a", user_id: id, email_hash: await trial.emailHash("giulia.rossi@gmail.com"), card_fingerprint: "fp_x", trial_end: null, reminded_for: null });
  const twin = newUser("user-a-twin", "GiuliaRossi+2@googlemail.com");
  assert.equal((await checkout(twin, { plan: "personal", interval: "monthly", start_trial: true }, 409)).res.body.code, "trial_unavailable");
  assert.equal((await checkout(twin, { plan: "personal", interval: "monthly" }, 200, DESKTOP)).params.subscription_data.trial_period_days, undefined, "no trial for an old client either");
  assert.equal((await checkout(twin, { plan: "personal", interval: "monthly", language: "en" })).params.subscription_data.trial_period_days, undefined, "nor without a choice");
  newUser("user-live", undefined, { subscription_status: "past_due", has_used_trial: true });
  await checkout("user-live", { plan: "personal", interval: "monthly", start_trial: true }, 409);
}

// --- Prices come from Stripe, cached; inactive ones are not published.
{
  const listed = await trial.publicPrices(process.env, async (id) => { priceReads += 1; return prices[id] as any; }, Date.parse("2026-10-14T10:00:00Z"));
  assert.deepEqual(listed.prices.map((p) => [p.plan, p.interval, p.amount, p.currency, p.perSeat]), [
    ["personal", "monthly", 799, "eur", false], ["personal", "yearly", 7990, "eur", false], ["business", "monthly", 1499, "eur", true],
  ]);
  assert.equal(listed.trialEnabled, true);
  assert.equal(listed.trialDays, 3);
  const reads = priceReads;
  await trial.publicPrices(process.env, async (id) => { priceReads += 1; return prices[id] as any; }, Date.parse("2026-10-14T10:05:00Z"));
  assert.equal(priceReads, reads, "cached for ten minutes");
  const res = response();
  await billing({ method: "GET", query: { action: "prices" }, headers: { origin: "https://tauri.localhost" } }, res as any);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["access-control-allow-origin"], "https://tauri.localhost");
  assert.equal(/price_|sk_test|cus_/.test(JSON.stringify(res.body)), false, "no Stripe identifiers in public");
}

// --- What /api/account says to the apps.
resetDb();
{
  newUser("user-b", "b@example.test", { subscription_status: "trialing", current_period_end: "2026-10-17T10:00:00.000Z", plan: "personal", billing_interval: "month", has_used_trial: true });
  const res = response();
  await account({ method: "GET", headers: { authorization: "Bearer user-b" } }, res as any);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.active, true);
  assert.equal(res.body.status, "trialing", "old clients read the same fields as before");
  assert.deepEqual({ ...res.body.billing }, {
    trialEnabled: true, trialDays: 3, trialLength: 7, state: "trialing", blockedReason: "none", plan: "personal", interval: "month",
    trialEndsAt: "2026-10-17T10:00:00.000Z", currentPeriodEnd: "2026-10-17T10:00:00.000Z", cancelAtPeriodEnd: false,
    canStartTrial: false, trialUsed: true, portalAvailable: true,
  });
  newUser("user-new", "new@example.test");
  const fresh = response();
  await account({ method: "GET", headers: { authorization: "Bearer user-new" } }, fresh as any);
  assert.equal(fresh.body.billing.canStartTrial, true);
  assert.equal(fresh.body.billing.state, "none");
  newUser("user-paused", "p@example.test", { subscription_status: "past_due", current_period_end: "2026-10-17T10:00:00.000Z", plan: "personal", has_used_trial: true });
  const paused = response();
  await account({ method: "GET", headers: { authorization: "Bearer user-paused" } }, paused as any);
  assert.equal(paused.body.active, false, "a failed payment blocks at once");
  assert.equal(paused.body.billing.state, "blocked");
  assert.equal(paused.body.billing.blockedReason, "payment_failed");
  process.env.TRIAL_ENABLED = "false";
  const off = response();
  db.calls = [];
  await account({ method: "GET", headers: { authorization: "Bearer user-new" } }, off as any);
  assert.equal(off.body.billing.canStartTrial, false);
  assert.equal(db.calls.some((c) => c.url.includes("redaxa_trial")), false, "switch off: no trial table is read");
  process.env.TRIAL_ENABLED = "true";
}

// --- The webhook: claim, refuse, keep what runs.
const trialStart = Math.floor(Date.parse("2026-10-14T10:00:00Z") / 1000);
const trialEnd = trialStart + 3 * 86_400;
function subscription(id: string, userId: string, fields: Row = {}): any {
  const sub = {
    id, customer: "cus_fixture", status: "trialing", cancel_at_period_end: false, trial_start: trialStart, trial_end: trialEnd,
    default_payment_method: `pm_${userId}`, cancellation_details: null, ended_at: null, canceled_at: null,
    metadata: { redaxa_user_id: userId, plan: "personal", interval: "monthly", seats: "1", trial: "3d", lang: "en" },
    items: { data: [{ quantity: 1, current_period_end: trialEnd, price: { unit_amount: 799, currency: "eur", tax_behavior: "exclusive", recurring: { interval: "month" } } }] },
    ...fields,
  };
  subscriptions.set(id, sub);
  return sub;
}
const mails = () => readdirSync(sinkDir).filter((f) => f.endsWith(".txt")).map((f) => readFileSync(join(sinkDir, f), "utf8"));
const clearMails = () => { for (const f of readdirSync(sinkDir)) rmSync(join(sinkDir, f)); };
async function deliver(type: string, object: unknown) {
  s.webhooks.constructEvent = () => ({ id: `evt_${Math.random()}`, type, data: { object } });
  const req = Object.assign(Readable.from([Buffer.from("{}")]), { method: "POST", headers: { "stripe-signature": "t=1,v1=fixture" } });
  const res = response();
  await webhook(req as any, res as any);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}

resetDb(); clearMails(); cancelled.length = 0;
{
  newUser("user-c", "c@example.test", { has_used_trial: false });
  const sub = subscription("sub_c", "user-c");
  assert.equal(await syncSubscription(sub), "user-c");
  assert.equal(db.accounts.get("user-c")!.subscription_status, "trialing");
  assert.equal(db.claims.length, 1);
  assert.equal(db.claims[0].card_fingerprint, "fp_pm_user-c");
  assert.equal(db.claims[0].email_hash, await trial.emailHash("c@example.test"));
  assert.equal(await syncSubscription(sub), "user-c", "a replayed event keeps its own claim");
  const own = response();
  await account({ method: "GET", headers: { authorization: "Bearer user-c" } }, own as any);
  assert.equal(own.body.billing.trialLength, 3, "the running trial's own length, for the progress in the sidebar");
  await deliver("customer.subscription.created", sub);
  const started = mails().find((m) => m.startsWith("Pro is on for 3 days, Giulia."));
  assert.ok(started, mails().join("\n----\n"));
  assert.match(started!, /On 17 October 2026 at 10:00 UTC the trial ends and Pro — Monthly starts at €4\.87/);
  assert.match(started!, /After that: €7\.99 a month excl\. VAT/);

  // Same card on another account and mailbox: refused before any charge.
  newUser("user-d", "d@example.test", { has_used_trial: false });
  const copy = subscription("sub_d", "user-d", { default_payment_method: "pm_user-c" });
  assert.equal(await syncSubscription(copy), null);
  assert.deepEqual(cancelled, [{ id: "sub_d", comment: "trial_rejected" }]);
  assert.equal(db.accounts.get("user-d")!.subscription_status, "trial_rejected");
  assert.equal(db.accounts.get("user-d")!.current_period_end, null);
  assert.ok(mails().some((m) => m.startsWith("Your trial could not start, Giulia.")));
  // Its cancellation arrives later and still reads as a refused trial.
  await deliver("customer.subscription.deleted", subscriptions.get("sub_d"));
  assert.equal(db.accounts.get("user-d")!.subscription_status, "trial_rejected");

  // A second checkout by someone already in trial: dropped, their trial goes on, no email.
  clearMails();
  const second = subscription("sub_c2", "user-c", { default_payment_method: "pm_other" });
  assert.equal(await syncSubscription(second), null);
  await deliver("customer.subscription.deleted", subscriptions.get("sub_c2"));
  assert.equal(db.accounts.get("user-c")!.stripe_subscription_id, "sub_c");
  assert.equal(db.accounts.get("user-c")!.subscription_status, "trialing");
  assert.equal(mails().length, 0);

  // Converted: the first paid invoice after the trial.
  Object.assign(sub, { status: "active", items: { data: [{ ...sub.items.data[0], current_period_end: trialEnd + 31 * 86_400 }] } });
  const paid = { id: "in_paid", billing_reason: "subscription_cycle", amount_paid: 487, amount_due: 487, currency: "eur", attempt_count: 1,
    parent: { subscription_details: { subscription: "sub_c" } }, lines: { data: [{ period: { start: trialEnd, end: trialEnd + 31 * 86_400 } }] } };
  await deliver("invoice.paid", paid);
  assert.equal(db.accounts.get("user-c")!.subscription_status, "active");
  assert.ok(mails().some((m) => m.startsWith("Your trial is over and Pro stays on, Giulia.") && m.includes("Renews on: 17 November 2026")), mails().join("\n----\n"));

  // A later renewal fails: blocked at once, told once with the reason.
  clearMails();
  Object.assign(sub, { status: "past_due" });
  const failed = { ...paid, id: "in_failed", amount_paid: 0, amount_due: 799, lines: { data: [{ period: { start: trialEnd + 31 * 86_400, end: trialEnd + 61 * 86_400 } }] } };
  await deliver("invoice.payment_failed", failed);
  assert.equal(db.accounts.get("user-c")!.subscription_status, "past_due");
  const blocked = mails().filter((m) => m.startsWith("Pro is paused until the payment goes through, Giulia."));
  assert.equal(blocked.length, 1);
  assert.match(blocked[0], /€7\.99 for Pro — Monthly: insufficient funds/);
  await deliver("invoice.payment_failed", { ...failed, attempt_count: 2 });
  assert.equal(mails().length, 1, "a retry of the same charge is not mailed again");
  // The retry succeeds: back to active by itself.
  Object.assign(sub, { status: "active" });
  await deliver("invoice.paid", { ...failed, amount_paid: 799 });
  assert.equal(db.accounts.get("user-c")!.subscription_status, "active");

  // Cancelled during the trial: ends unpaid, told so.
  clearMails();
  newUser("user-e", "e@example.test", { has_used_trial: false });
  const quit = subscription("sub_e", "user-e", { default_payment_method: "pm_user-e" });
  await syncSubscription(quit);
  Object.assign(quit, { status: "canceled", ended_at: trialEnd, canceled_at: trialStart + 3600 });
  await deliver("customer.subscription.deleted", quit);
  assert.equal(db.accounts.get("user-e")!.subscription_status, "canceled");
  assert.ok(mails().some((m) => m.startsWith("Pro is off and nothing was charged, Giulia.")));

  // A subscription sold before the rule (no mark) is left exactly as before.
  clearMails();
  newUser("user-old", "old@example.test", { has_used_trial: false });
  const old = subscription("sub_old", "user-old", { metadata: { redaxa_user_id: "user-old", plan: "personal", interval: "monthly" } });
  const claimsBefore = db.claims.length;
  await deliver("customer.subscription.created", old);
  assert.equal(db.claims.length, claimsBefore, "no claim for an unmarked trial");
  assert.ok(mails().some((m) => m.includes("Your seven-day Redaxa trial has started")), "the legacy email, unchanged");
}

// --- The reminder a day before the end: only with the cron secret, once.
resetDb(); clearMails();
{
  newUser("user-r", "r@example.test", { has_used_trial: true, subscription_status: "trialing" });
  const sub = subscription("sub_r", "user-r", { metadata: { redaxa_user_id: "user-r", plan: "personal", interval: "yearly", trial: "3d", lang: "de" },
    items: { data: [{ quantity: 1, current_period_end: trialEnd, price: { unit_amount: 7990, currency: "eur", tax_behavior: "exclusive", recurring: { interval: "year" } } }] } });
  db.claims.push({ subscription_id: "sub_r", user_id: "user-r", email_hash: "x", card_fingerprint: null, trial_end: new Date(trialEnd * 1000).toISOString(), reminded_for: null });
  const anonymous = response();
  delete process.env.CRON_SECRET;
  await billing({ method: "GET", headers: { "x-vercel-cron-schedule": "0 7 * * *" } }, anonymous as any);
  assert.equal(anonymous.statusCode, 401, "no secret configured: nothing runs");
  process.env.CRON_SECRET = "cron-fixture-secret-0123456789";
  const wrong = response();
  await billing({ method: "GET", headers: { "x-vercel-cron-schedule": "0 7 * * *", authorization: "Bearer nope" } }, wrong as any);
  assert.equal(wrong.statusCode, 401);
  const cron = response();
  await billing({ method: "GET", headers: { "x-vercel-cron-schedule": "0 7 * * *", authorization: "Bearer cron-fixture-secret-0123456789" } }, cron as any);
  assert.equal(cron.statusCode, 200, JSON.stringify(cron.body));
  assert.deepEqual(cron.body, { due: 1, sent: 1 });
  assert.equal(db.claims[0].reminded_for, new Date(trialEnd * 1000).toISOString());
  const reminder = mails().find((m) => m.startsWith("Ihre Testphase endet am 17. Oktober, Giulia."));
  assert.ok(reminder, mails().join("\n----\n"));
  assert.match(reminder!, /Tarif: Pro — Jährlich/);
  assert.equal((await sendTrialReminders()).due, 0, "reminded once");
  // A trial cancelled before the run is not reminded.
  db.claims[0].reminded_for = null;
  Object.assign(sub, { cancel_at_period_end: true });
  assert.deepEqual(await sendTrialReminders(), { due: 1, sent: 0 });
}

// --- Every email in every language: complete, no placeholder left behind.
{
  const base = { to: "x@example.test", firstName: "Ana", plan: "business", interval: "yearly", seats: 3, days: 3, trialEnd, renewsOn: trialEnd + 365 * 86_400, endedOn: trialEnd,
    charge: { amount: 22200, currency: "eur" }, renew: { amount: 44970, currency: "eur", taxExclusive: true }, failure: "expired_card" as const };
  for (const lang of Object.keys(TRIAL_WORDS) as Array<keyof typeof TRIAL_WORDS>) {
    for (const kind of ["trial_started", "trial_ending", "trial_paid", "payment_failed", "trial_ended", "trial_rejected"] as const) {
      const mail = trialMail(kind, { ...base, lang });
      for (const part of [mail.subject, mail.text, mail.html]) {
        assert.doesNotMatch(part, /\bundefined\b|\bnull\b|NaN|\$\{|\{[a-z]+\}/, `${lang}/${kind}`);
      }
      assert.match(mail.html, new RegExp(`<html lang="${lang}"`), `${lang}/${kind}`);
      if (kind !== "trial_rejected" && kind !== "trial_ended") assert.match(mail.text, /222/, `${lang}/${kind} quotes the charge`);
      assert.doesNotMatch(mail.text, /refund|rimbors|reembols|rembours|Rückerstatt/i, `${lang}/${kind} never mentions refunds`);
    }
  }
  // Without a known charge the sentence still reads.
  const bare = trialMail("trial_ending", { to: "x@example.test", lang: "en", plan: "personal", interval: "monthly", seats: 1, days: 3, trialEnd });
  assert.match(bare.text, /the plan's price is charged/);
  assert.doesNotMatch(bare.text, /First charge:/);
}

rmSync(sinkDir, { recursive: true, force: true });
console.log("_trial.test.ts ok");
