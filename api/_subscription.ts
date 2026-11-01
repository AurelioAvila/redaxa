/**
 * "Manage subscription" in the account menu: what is active on this account,
 * and stopping or resuming its renewal without leaving the app.
 *
 *   GET  /api/billing/subscription          -> SubscriptionState
 *   POST /api/billing/subscription/cancel   -> SubscriptionState (cancel_at_period_end = true)
 *   POST /api/billing/subscription/resume   -> SubscriptionState (cancel_at_period_end = false)
 *
 * vercel.json rewrites those paths onto api/billing.ts (?action=subscription,
 * subscription-cancel, subscription-resume): the project sits at Vercel's
 * twelve-function cap. The caller's own subscription only, found through their
 * billing_accounts row, never through an id the client sends. Cancelling never
 * ends access early and never refunds: the plan runs to the end of the period
 * already paid for (or the trial ends without a charge), then the
 * customer.subscription.deleted webhook closes it. Updating cancel_at_period_end
 * is allowed on Managed Payments subscriptions (only default_payment_method is
 * locked to the portal); if Stripe refuses anyway, the answer carries a billing
 * portal link that opens straight on the cancel flow.
 *
 * Cancel may carry an optional { reason, comment } (Stripe's own
 * cancellation_details feedback codes): stored on the subscription with the
 * same update, and sent to the owner in one notice per cancellation.
 */
import type Stripe from "stripe";
import type { BillingAccount } from "./_billing.js";

type Sub = Pick<Stripe.Subscription, "id" | "customer" | "status" | "trial_end" | "cancel_at" | "cancel_at_period_end" | "metadata" | "items" | "default_payment_method">;

export type SubscriptionDeps = {
  accountFor(userId: string): Promise<BillingAccount | null>;
  /** The workspace owner's address when the caller's access comes from a Business team. */
  memberOf(userId: string): Promise<string | null>;
  retrieve(id: string): Promise<Sub>;
  /** cancel_at_period_end, or clearing a dated cancel_at the portal may have set. */
  update(id: string, params: { cancel_at_period_end: boolean; cancellation_details?: { feedback?: CancelReason; comment?: string } } | { cancel_at: "" }): Promise<Sub>;
  customerCard(customerId: string): Promise<{ brand: string; last4: string } | null>;
  patchAccount(userId: string, updates: Record<string, unknown>): Promise<void>;
  portalCancelUrl(customerId: string, subscriptionId: string): Promise<string>;
  /** The owner's notice of a scheduled cancellation. Best-effort; never blocks the answer. */
  notifyCancellation(notice: CancellationNotice): Promise<unknown>;
};

/** Stripe's cancellation_details.feedback codes, with the label the owner reads. */
export const CANCEL_REASONS = {
  too_expensive: "Too expensive",
  unused: "I don’t use it enough",
  missing_features: "Missing a feature I need",
  switched_service: "Switching to another tool",
  low_quality: "Technical problems / bugs",
  too_complex: "Too complicated to use",
  customer_service: "Problems with support",
  other: "Other",
} as const;
export type CancelReason = keyof typeof CANCEL_REASONS;
export type CancelFeedback = { reason: CancelReason | null; comment: string | null };
export const COMMENT_MAX = 500;

export type CancellationNotice = {
  subscriptionId: string; customerId: string; plan: "pro" | "business"; interval: "month" | "year" | null; seats: number;
  /** ISO: the last day of access (cancel_at, or the period / trial end). */
  endsAt: string | null; trialing: boolean; reason: CancelReason | null; comment: string | null;
};

export type SubscriptionState = {
  product: "redaxa";
  plan: "pro" | "business" | null;
  interval: "month" | "year" | null;
  /** Euro cents for every seat, per interval, before any one-off discount. */
  amount: number | null;
  currency: string | null;
  seats: number | null;
  status: string;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  payment_method: { brand: string; last4: string } | null;
  lifetime: false;
  can_cancel: boolean;
  can_resume: boolean;
  /** Redaxa only: the Business workspace owner whose plan the caller uses. */
  member_of: string | null;
};

const iso = (seconds: number | null | undefined): string | null => seconds ? new Date(seconds * 1000).toISOString() : null;
/** Statuses where there is still a renewal to stop or resume. */
const RUNNING = new Set(["trialing", "active", "past_due", "unpaid", "incomplete", "paused"]);

export class SubscriptionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly portalUrl?: string) { super(message); }
}

/** The optional { reason, comment } of a cancel request. Absent or empty is
 *  fine (no reason given); an unknown reason or an over-long comment is a 400.
 *  Control and bidirectional-override characters never reach Stripe or the
 *  owner's mail: line breaks become spaces, the rest is dropped. */
export function cancelFeedback(body: unknown): CancelFeedback {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const rawReason = input.reason;
  if (rawReason != null && rawReason !== "" && (typeof rawReason !== "string" || !Object.hasOwn(CANCEL_REASONS, rawReason))) {
    throw new SubscriptionError(400, "invalid_reason", "Choose one of the listed reasons, or none.");
  }
  if (input.comment != null && typeof input.comment !== "string") throw new SubscriptionError(400, "invalid_comment", "The comment must be text.");
  const comment = String(input.comment ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
  if (comment.length > COMMENT_MAX) throw new SubscriptionError(400, "comment_too_long", `Keep the comment under ${COMMENT_MAX} characters.`);
  return { reason: rawReason ? rawReason as CancelReason : null, comment: comment || null };
}

function none(memberOf: string | null): SubscriptionState {
  return { product: "redaxa", plan: null, interval: null, amount: null, currency: null, seats: null, status: "none", trial_end: null, current_period_end: null, cancel_at_period_end: false, cancel_at: null, payment_method: null, lifetime: false, can_cancel: false, can_resume: false, member_of: memberOf };
}

function cardOf(method: Sub["default_payment_method"]): { brand: string; last4: string } | null {
  if (!method || typeof method === "string") return null;
  if (method.card) return { brand: method.card.brand, last4: method.card.last4 };
  const link = (method as { link?: { email?: string } }).link;
  return link ? { brand: "link", last4: "" } : null;
}

async function describe(sub: Sub, deps: SubscriptionDeps): Promise<SubscriptionState> {
  const item = sub.items.data[0];
  const price = item?.price;
  const seats = item?.quantity ?? 1;
  const recurring = price?.recurring?.interval;
  const plan = sub.metadata?.plan === "business" ? "business" : "pro";
  const interval: SubscriptionState["interval"] = recurring === "year" ? "year" : recurring === "month" ? "month" : sub.metadata?.interval === "yearly" ? "year" : sub.metadata?.interval === "monthly" ? "month" : null;
  const ending = sub.cancel_at_period_end || Boolean(sub.cancel_at);
  return {
    product: "redaxa", plan, interval,
    amount: price?.unit_amount != null ? price.unit_amount * seats : null,
    currency: price?.currency ?? null,
    seats,
    status: sub.status,
    trial_end: iso(sub.trial_end),
    current_period_end: iso(item?.current_period_end),
    // A dated cancel_at (set by the portal on newer API versions) ends the plan the same way.
    cancel_at_period_end: ending,
    cancel_at: iso(sub.cancel_at),
    payment_method: cardOf(sub.default_payment_method) ?? await deps.customerCard(String(sub.customer)).catch(() => null),
    lifetime: false,
    can_cancel: !ending,
    can_resume: ending,
    member_of: null,
  };
}

/** The caller's subscription, or null when the account has none (or the
 *  recorded id does not belong to the account's own Stripe customer). */
async function own(userId: string, deps: SubscriptionDeps): Promise<{ account: BillingAccount; sub: Sub } | null> {
  const account = await deps.accountFor(userId);
  if (!account?.stripe_subscription_id || !account.stripe_customer_id) return null;
  const sub = await deps.retrieve(account.stripe_subscription_id).catch((error: { statusCode?: number }) => {
    if (error?.statusCode === 404) return null;
    throw error;
  });
  if (!sub || String(sub.customer) !== account.stripe_customer_id) return null;
  return { account, sub };
}

export async function subscriptionState(userId: string, deps: SubscriptionDeps): Promise<SubscriptionState> {
  const found = await own(userId, deps);
  if (!found || !RUNNING.has(found.sub.status)) return none(await deps.memberOf(userId).catch(() => null));
  return describe(found.sub, deps);
}

/** Sets or clears cancel_at_period_end on the caller's own subscription.
 *  Idempotent: asking for the state it is already in changes nothing. */
export async function setCancelAtPeriodEnd(userId: string, cancel: boolean, deps: SubscriptionDeps, feedback: CancelFeedback = { reason: null, comment: null }): Promise<SubscriptionState> {
  const found = await own(userId, deps);
  if (!found || !RUNNING.has(found.sub.status)) {
    throw new SubscriptionError(404, "no_subscription", cancel ? "There is no subscription to cancel on this account." : "This subscription has already ended. Choose a plan to subscribe again.");
  }
  const { account, sub } = found;
  const ending = sub.cancel_at_period_end || Boolean(sub.cancel_at);
  if (ending === cancel) return describe(sub, deps);
  let updated: Sub;
  try {
    const details = cancel && (feedback.reason || feedback.comment)
      ? { cancellation_details: { ...(feedback.reason ? { feedback: feedback.reason } : {}), ...(feedback.comment ? { comment: feedback.comment } : {}) } }
      : {};
    updated = await deps.update(sub.id, !cancel && !sub.cancel_at_period_end ? { cancel_at: "" } : { cancel_at_period_end: cancel, ...details });
  } catch (error) {
    // Stripe refused the change (e.g. a Managed Payments restriction): the
    // portal can still do it, opened on the cancellation itself.
    console.error(`subscription ${cancel ? "cancel" : "resume"} refused by Stripe for ${sub.id}:`, String((error as Error)?.message ?? error).slice(0, 200));
    const portalUrl = await deps.portalCancelUrl(account.stripe_customer_id!, sub.id).catch(() => undefined);
    throw new SubscriptionError(502, "billing_unavailable", "We could not change the subscription here. Continue in the billing portal.", portalUrl);
  }
  // Audit line: who, what, which subscription. No personal details.
  console.log(JSON.stringify({ audit: "redaxa.subscription", action: cancel ? "cancel_at_period_end" : "resume", user: userId, subscription: sub.id }));
  // The webhook records the same within seconds; this keeps the app's own
  // account view right in the meantime.
  await deps.patchAccount(userId, { cancel_at_period_end: updated.cancel_at_period_end || Boolean(updated.cancel_at) }).catch(() => undefined);
  const state = await describe(updated, deps);
  // Only a real change reaches here (asking again returned above), so one
  // cancellation is one notice; the mail's idempotency key covers a retry.
  if (cancel) {
    await deps.notifyCancellation({
      subscriptionId: sub.id, customerId: account.stripe_customer_id!, plan: state.plan ?? "pro", interval: state.interval, seats: state.seats ?? 1,
      endsAt: state.status === "trialing" ? (state.cancel_at ?? state.trial_end ?? state.current_period_end) : (state.cancel_at ?? state.current_period_end),
      trialing: state.status === "trialing", reason: feedback.reason, comment: feedback.comment,
    }).catch(() => undefined);
  }
  return state;
}
