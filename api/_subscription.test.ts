import assert from "node:assert/strict";
import { SubscriptionError, setCancelAtPeriodEnd, subscriptionState, type SubscriptionDeps } from "./_subscription.js";

// Manage subscription: GET state, cancel at period end, resume. Fakes only —
// no Stripe call, no live subscription is ever touched.
type Sub = Awaited<ReturnType<SubscriptionDeps["retrieve"]>>;
const PERIOD_END = Date.parse("2027-03-12T10:00:00Z") / 1000;

function sub(fields: Partial<Record<string, unknown>> = {}): Sub {
  return {
    id: "sub_mine", customer: "cus_mine", status: "active", trial_end: null, cancel_at: null, cancel_at_period_end: false,
    metadata: { plan: "business", interval: "yearly" },
    items: { data: [{ quantity: 2, current_period_end: PERIOD_END, price: { unit_amount: 14990, currency: "eur", recurring: { interval: "year" } } }] },
    default_payment_method: { card: { brand: "visa", last4: "4242" } },
    ...fields,
  } as unknown as Sub;
}

function fakes(initial: Sub | null, account: Record<string, unknown> | null = { stripe_customer_id: "cus_mine", stripe_subscription_id: "sub_mine" }) {
  let current = initial;
  const calls = { update: [] as unknown[], patch: [] as unknown[] };
  const deps: SubscriptionDeps = {
    accountFor: async (userId) => userId === "user-1" ? account as never : null,
    memberOf: async (userId) => userId === "member-1" ? "owner@example.test" : null,
    retrieve: async (id) => {
      if (!current || current.id !== id) throw Object.assign(new Error("No such subscription"), { statusCode: 404 });
      return current;
    },
    update: async (id, params) => {
      calls.update.push({ id, ...params });
      const p = params as { cancel_at_period_end?: boolean; cancel_at?: "" };
      current = { ...current!, cancel_at_period_end: p.cancel_at_period_end ?? false, cancel_at: p.cancel_at === "" ? null : p.cancel_at_period_end ? PERIOD_END : null } as Sub;
      return current;
    },
    customerCard: async () => ({ brand: "mastercard", last4: "0005" }),
    patchAccount: async (userId, updates) => { calls.patch.push({ userId, ...updates }); },
    portalCancelUrl: async () => "https://billing.stripe.com/p/session/test_fixture",
  };
  return { deps, calls };
}

const quiet = console.log;
console.log = () => undefined; // the audit line
try {
  // The caller's own subscription, described in the shared contract's shape.
  {
    const { deps } = fakes(sub());
    const state = await subscriptionState("user-1", deps);
    assert.deepEqual(state, {
      product: "redaxa", plan: "business", interval: "year", amount: 29980, currency: "eur", seats: 2, status: "active",
      trial_end: null, current_period_end: "2027-03-12T10:00:00.000Z", cancel_at_period_end: false, cancel_at: null,
      payment_method: { brand: "visa", last4: "4242" }, lifetime: false, can_cancel: true, can_resume: false, member_of: null,
    });
  }
  // No card on the subscription: the customer's default card.
  {
    const { deps } = fakes(sub({ default_payment_method: null, metadata: {}, items: { data: [{ quantity: 1, current_period_end: PERIOD_END, price: { unit_amount: 799, currency: "eur", recurring: { interval: "month" } } }] } }));
    const state = await subscriptionState("user-1", deps);
    assert.equal(state.plan, "pro");
    assert.equal(state.interval, "month");
    assert.equal(state.amount, 799);
    assert.deepEqual(state.payment_method, { brand: "mastercard", last4: "0005" });
  }
  // No subscription: GET says so, cancel and resume are 404, and a team member is told whose plan they use.
  {
    const { deps, calls } = fakes(null, { stripe_customer_id: null, stripe_subscription_id: null });
    assert.equal((await subscriptionState("user-1", deps)).status, "none");
    const member = await subscriptionState("member-1", deps);
    assert.equal(member.status, "none");
    assert.equal(member.member_of, "owner@example.test");
    for (const cancel of [true, false]) {
      await assert.rejects(setCancelAtPeriodEnd("user-1", cancel, deps), (e: unknown) => e instanceof SubscriptionError && e.status === 404);
    }
    assert.equal(calls.update.length, 0);
  }
  // Another customer's subscription id on this account (never expected): treated as none, never changed.
  {
    const { deps, calls } = fakes(sub({ customer: "cus_someone_else" }));
    assert.equal((await subscriptionState("user-1", deps)).status, "none");
    await assert.rejects(setCancelAtPeriodEnd("user-1", true, deps), (e: unknown) => e instanceof SubscriptionError && e.status === 404);
    assert.equal(calls.update.length, 0);
  }
  // Someone else's account: nothing to see or cancel.
  {
    const { deps, calls } = fakes(sub());
    assert.equal((await subscriptionState("user-2", deps)).status, "none");
    await assert.rejects(setCancelAtPeriodEnd("user-2", true, deps), (e: unknown) => e instanceof SubscriptionError && e.status === 404);
    assert.equal(calls.update.length, 0);
  }
  // Cancel sets cancel_at_period_end (never an immediate cancel) and is idempotent; resume undoes it, once.
  {
    const { deps, calls } = fakes(sub());
    const cancelled = await setCancelAtPeriodEnd("user-1", true, deps);
    assert.equal(cancelled.cancel_at_period_end, true);
    assert.equal(cancelled.can_cancel, false);
    assert.equal(cancelled.can_resume, true);
    assert.equal(cancelled.status, "active", "access runs to the end of the paid period");
    assert.equal(cancelled.current_period_end, "2027-03-12T10:00:00.000Z");
    assert.deepEqual(calls.update, [{ id: "sub_mine", cancel_at_period_end: true }]);
    assert.deepEqual(calls.patch, [{ userId: "user-1", cancel_at_period_end: true }]);
    assert.equal((await setCancelAtPeriodEnd("user-1", true, deps)).cancel_at_period_end, true);
    assert.equal(calls.update.length, 1, "cancelling twice changes nothing the second time");
    const resumed = await setCancelAtPeriodEnd("user-1", false, deps);
    assert.equal(resumed.cancel_at_period_end, false);
    await setCancelAtPeriodEnd("user-1", false, deps);
    assert.equal(calls.update.length, 2, "resuming twice changes nothing the second time");
  }
  // A dated cancel_at left by the billing portal counts as cancelling, and resume clears it.
  {
    const { deps, calls } = fakes(sub({ cancel_at: PERIOD_END }));
    assert.equal((await subscriptionState("user-1", deps)).cancel_at_period_end, true);
    await setCancelAtPeriodEnd("user-1", true, deps);
    assert.equal(calls.update.length, 0);
    const resumed = await setCancelAtPeriodEnd("user-1", false, deps);
    assert.deepEqual(calls.update, [{ id: "sub_mine", cancel_at: "" }]);
    assert.equal(resumed.cancel_at_period_end, false);
  }
  // A trial cancelled at its end: nothing is charged, the trial date is reported.
  {
    const trialEnd = Date.parse("2026-11-04T10:00:00Z") / 1000;
    const { deps } = fakes(sub({ status: "trialing", trial_end: trialEnd }));
    const state = await setCancelAtPeriodEnd("user-1", true, deps);
    assert.equal(state.status, "trialing");
    assert.equal(state.trial_end, "2026-11-04T10:00:00.000Z");
    assert.equal(state.cancel_at_period_end, true);
  }
  // An ended subscription cannot be resumed; it reads as none.
  {
    const { deps, calls } = fakes(sub({ status: "canceled" }));
    assert.equal((await subscriptionState("user-1", deps)).status, "none");
    await assert.rejects(setCancelAtPeriodEnd("user-1", false, deps), (e: unknown) => e instanceof SubscriptionError && e.status === 404 && /already ended/.test(e.message));
    assert.equal(calls.update.length, 0);
  }
  // Stripe refuses the update (e.g. a Managed Payments restriction): the portal's cancel flow is offered instead.
  {
    const { deps } = fakes(sub());
    deps.update = async () => { throw new Error("This subscription cannot be updated."); };
    const quietError = console.error; console.error = () => undefined;
    try {
      await assert.rejects(setCancelAtPeriodEnd("user-1", true, deps), (e: unknown) => e instanceof SubscriptionError && e.code === "billing_unavailable" && e.portalUrl === "https://billing.stripe.com/p/session/test_fixture");
    } finally { console.error = quietError; }
  }
  // Redaxa sells subscriptions only: never a lifetime licence.
  {
    const { deps } = fakes(sub());
    assert.equal((await subscriptionState("user-1", deps)).lifetime, false);
  }
} finally {
  console.log = quiet;
}
console.log("Manage subscription: own subscription only, none, cancel at period end (idempotent), resume, trial, portal fallback passed.");
