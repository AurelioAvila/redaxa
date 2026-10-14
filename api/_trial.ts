import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { stripe, supabaseService, type BillingAccount } from "./_billing.js";

/**
 * Three-day free trial on Pro and Business (owner decision, 14 October 2026),
 * the same rules as the PC Tweaker family:
 *
 * - The customer chooses: "Start 3-day free trial" or "Subscribe now" (charged
 *   at once, no trial). The client asks with `start_trial`; the server grants
 *   it only to an eligible account.
 * - A card or another recurring method Stripe accepts is collected before the
 *   trial starts; without one at the end the subscription cancels itself.
 * - The first charge follows on its own. A failed charge blocks the plan at
 *   once: `past_due` and every other status but `trialing`/`active` already
 *   grant nothing here (hasActiveEntitlement), and it comes back by itself
 *   when a retry succeeds.
 * - One trial per account, per normalised email and, where Stripe exposes
 *   one, per card fingerprint. The arbiter is a unique index checked when
 *   Stripe creates the subscription, so several open checkouts cannot win
 *   several trials.
 *
 * Off unless TRIAL_ENABLED=true. Off means exactly what ran before: clients
 * that never send `start_trial` get the seven-day trial they advertise, and
 * nothing here touches the trial tables. Subscriptions sold with a policed
 * trial carry `trial` in their metadata and keep these rules even if the
 * switch is turned off again.
 */
export const TRIAL_DAYS = 3;
/** Metadata mark of a trial sold under the one-per-person rule. */
export const TRIAL_MARK = "3d";
/** Clients from before the choice (Windows app 0.5.5 and older) promise seven
 *  days; with the switch on they keep that length under the same rule. */
export const LEGACY_TRIAL_DAYS = 7;
export const LEGACY_TRIAL_MARK = "7d";
/** Our own status for a trial cancelled because the person already had one,
 *  also the cancellation comment Stripe keeps on the subscription. */
export const TRIAL_REJECTED = "trial_rejected";
export const LANGUAGES = ["en", "it", "es", "fr", "de"] as const;
export type Language = (typeof LANGUAGES)[number];

export function trialEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.TRIAL_ENABLED === "true";
}

export function language(value: unknown): Language {
  return LANGUAGES.includes(value as Language) ? value as Language : "en";
}

/** Lowercase, trimmed, without a +tag; Gmail also ignores dots. */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  let local = email.slice(0, at).split("+")[0];
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** Only this hash of the address is kept for the trial rule, never the address. */
export function emailHash(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

type SubscriptionLike = { status: string; metadata?: Record<string, string> | null; cancellation_details?: { comment?: string | null } | null };

/** A subscription sold with a trial under the one-per-person rule. */
export function isOurTrial(subscription: Pick<SubscriptionLike, "metadata">): boolean {
  const mark = subscription.metadata?.trial;
  return mark === TRIAL_MARK || mark === LEGACY_TRIAL_MARK;
}

/** The status written to the account: a refused trial stays recognisable
 *  whatever order its cancellation events arrive in. */
export function recordedStatus(subscription: SubscriptionLike): string {
  return subscription.cancellation_details?.comment === TRIAL_REJECTED ? TRIAL_REJECTED : subscription.status;
}

/** Statuses of a subscription that still exists and could bill. */
const LIVE = new Set(["trialing", "active", "past_due", "unpaid", "incomplete", "paused"]);
export const isLive = (status: string | null | undefined): boolean => Boolean(status && LIVE.has(status));

/** False when a subscription that is no longer live would overwrite another
 *  one the account still holds live: a late event for an old subscription,
 *  or a refused second trial, must not end the plan that is running. */
export function ownsAccount(account: Pick<BillingAccount, "stripe_subscription_id" | "subscription_status"> | null, subscription: { id: string; status: string }): boolean {
  if (!account?.stripe_subscription_id || account.stripe_subscription_id === subscription.id) return true;
  return !isLive(account.subscription_status) || isLive(subscription.status);
}

export type BlockedReason = "none" | "payment_failed" | "canceled" | "trial_already_used";
export type BillingState = "none" | "trialing" | "active" | "blocked";

export function stateOf(status: string | null | undefined): { state: BillingState; blockedReason: BlockedReason } {
  if (!status) return { state: "none", blockedReason: "none" };
  if (status === "trialing") return { state: "trialing", blockedReason: "none" };
  if (status === "active") return { state: "active", blockedReason: "none" };
  if (status === TRIAL_REJECTED) return { state: "blocked", blockedReason: "trial_already_used" };
  if (status === "canceled") return { state: "blocked", blockedReason: "canceled" };
  return { state: "blocked", blockedReason: "payment_failed" };
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await supabaseService(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) {
    console.error(`${name} RPC failed:`, response.status, (await response.text()).slice(0, 300));
    throw new Error("TRIAL_STORAGE_ERROR");
  }
  return response.json() as Promise<T>;
}

/** Nobody with this account or this mailbox has had the trial yet. */
export async function trialAvailable(userId: string, email: string): Promise<boolean> {
  return (await rpc<boolean>("redaxa_trial_available", { p_user_id: userId, p_email_hash: emailHash(email) })) === true;
}

/** Whether a new checkout may carry the trial. The account must never have
 *  subscribed (`has_used_trial` is set by every subscription, trials sold
 *  before this rule included) and hold nothing live; the claim decides last. */
export async function trialEligible(userId: string, email: string, account: Pick<BillingAccount, "has_used_trial" | "subscription_status"> | null, environment: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!trialEnabled(environment) || account?.has_used_trial || isLive(account?.subscription_status)) return false;
  return trialAvailable(userId, email);
}

/** Records the trial of `subscriptionId`: true when this subscription holds
 *  the claim (first time or a replayed event), false when the account, the
 *  mailbox or the card already had one. */
export async function claimTrial(claim: { subscriptionId: string; userId: string; email: string; fingerprint: string | null; trialEnd: number | null }): Promise<boolean> {
  return (await rpc<boolean>("claim_redaxa_trial", {
    p_subscription_id: claim.subscriptionId,
    p_user_id: claim.userId,
    p_email_hash: emailHash(claim.email),
    p_card_fingerprint: claim.fingerprint,
    p_trial_end: claim.trialEnd ? new Date(claim.trialEnd * 1000).toISOString() : null,
  })) === true;
}

/** The card fingerprint behind a subscription, where Stripe exposes one. */
export async function cardFingerprint(subscription: Stripe.Subscription): Promise<string | null> {
  const ref = subscription.default_payment_method;
  const id = typeof ref === "string" ? ref : ref?.id;
  if (!id) return null;
  const method = typeof ref === "object" && ref ? ref : await stripe.paymentMethods.retrieve(id);
  return method.card?.fingerprint ?? null;
}

/** Ends a refused trial at once: nothing has been charged and nothing will be. */
export async function cancelRefusedTrial(id: string): Promise<void> {
  try {
    await stripe.subscriptions.cancel(id, { cancellation_details: { comment: TRIAL_REJECTED } });
  } catch (error) {
    // A retried event: the first attempt already cancelled it.
    if ((await stripe.subscriptions.retrieve(id)).status !== "canceled") throw error;
  }
}

// ---------------------------------------------------------------------------
// Prices, read from Stripe so no page or app writes one in its code.

export const PLAN_PRICES = [
  { plan: "personal", interval: "monthly", env: "STRIPE_PRICE_PERSONAL_MONTHLY" },
  { plan: "personal", interval: "yearly", env: "STRIPE_PRICE_PERSONAL_YEARLY" },
  { plan: "business", interval: "monthly", env: "STRIPE_PRICE_BUSINESS_MONTHLY" },
  { plan: "business", interval: "yearly", env: "STRIPE_PRICE_BUSINESS_YEARLY" },
] as const;

export type PriceView = { plan: string; interval: string; amount: number; currency: string; taxBehavior: string | null; perSeat: boolean };
type PriceReader = (id: string) => Promise<Pick<Stripe.Price, "active" | "unit_amount" | "currency" | "recurring" | "tax_behavior">>;
const priceCache = new Map<string, { until: number; value: Promise<Omit<PriceView, "plan" | "interval" | "perSeat"> | null> }>();

/** One Price as Stripe has it, cached ten minutes (one after a failure). */
function stripePrice(id: string | undefined, read: PriceReader, now: number) {
  if (!id) return Promise.resolve(null);
  const cached = priceCache.get(id);
  if (cached && cached.until > now) return cached.value;
  const entry = { until: now + 10 * 60_000, value: Promise.resolve(null as Omit<PriceView, "plan" | "interval" | "perSeat"> | null) };
  entry.value = read(id).then((price) => price.active && price.unit_amount != null && price.recurring
    ? { amount: price.unit_amount, currency: price.currency, taxBehavior: price.tax_behavior ?? null }
    : null).catch((error: Error) => {
    console.error("could not read a Stripe price:", error.message);
    entry.until = now + 60_000;
    return null;
  });
  priceCache.set(id, entry);
  return entry.value;
}

/** GET /api/billing?action=prices: public, for the site and the apps. */
export async function publicPrices(environment: NodeJS.ProcessEnv = process.env, read: PriceReader = (id) => stripe.prices.retrieve(id), now = Date.now()) {
  const prices = await Promise.all(PLAN_PRICES.map(async ({ plan, interval, env }) => {
    const price = await stripePrice(environment[env], read, now);
    return price && { plan, interval, ...price, perSeat: plan === "business" } as PriceView;
  }));
  return {
    serverTime: new Date(now).toISOString(),
    trialEnabled: trialEnabled(environment),
    trialDays: TRIAL_DAYS,
    prices: prices.filter((price): price is PriceView => price !== null),
  };
}

// ---------------------------------------------------------------------------
// What /api/account tells the apps about the account's own subscription.

export type BillingView = {
  trialEnabled: boolean;
  trialDays: number;
  state: BillingState;
  blockedReason: BlockedReason;
  plan: string | null;
  interval: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canStartTrial: boolean;
  /** The trial has been used on this account (or refused to it). */
  trialUsed: boolean;
  portalAvailable: boolean;
};

export async function billingView(user: { id: string; email: string }, account: (BillingAccount & { cancel_at_period_end?: boolean | null; billing_interval?: string | null }) | null, environment: NodeJS.ProcessEnv = process.env): Promise<BillingView> {
  const { state, blockedReason } = stateOf(account?.subscription_status);
  let canStartTrial = false;
  try {
    canStartTrial = await trialEligible(user.id, user.email, account, environment);
  } catch {
    // The account still loads; checkout asks again and decides.
  }
  return {
    trialEnabled: trialEnabled(environment),
    trialDays: TRIAL_DAYS,
    state,
    blockedReason,
    plan: account?.plan ?? null,
    interval: account?.billing_interval ?? null,
    trialEndsAt: state === "trialing" ? account?.current_period_end ?? null : null,
    currentPeriodEnd: state === "trialing" || state === "active" ? account?.current_period_end ?? null : null,
    cancelAtPeriodEnd: Boolean((state === "trialing" || state === "active") && account?.cancel_at_period_end),
    canStartTrial,
    trialUsed: Boolean(account?.has_used_trial) || blockedReason === "trial_already_used",
    portalAvailable: Boolean(account?.stripe_customer_id),
  };
}

// ---------------------------------------------------------------------------
// The reminder a day before a trial ends, sent by the cron sweep.

type DueClaim = { subscription_id: string; user_id: string; trial_end: string };

/** Trials ending between one and thirty hours from now that have not been
 *  reminded. Run every six hours, so each trial is seen once in that window
 *  about a day before its end, and again if a run is missed. */
export async function dueReminders(now = Date.now()): Promise<DueClaim[]> {
  const from = new Date(now + 60 * 60_000).toISOString();
  const to = new Date(now + 30 * 60 * 60_000).toISOString();
  const response = await supabaseService(`/rest/v1/redaxa_trial_claims?trial_end=gt.${encodeURIComponent(from)}&trial_end=lte.${encodeURIComponent(to)}&reminded_for=is.null&select=subscription_id,user_id,trial_end&limit=200`, { method: "GET" });
  if (!response.ok) throw new Error("TRIAL_STORAGE_ERROR");
  return response.json() as Promise<DueClaim[]>;
}

export async function markReminded(subscriptionId: string, trialEnd: string): Promise<void> {
  const response = await supabaseService(`/rest/v1/redaxa_trial_claims?subscription_id=eq.${encodeURIComponent(subscriptionId)}`, {
    method: "PATCH", body: JSON.stringify({ reminded_for: trialEnd }),
  });
  if (!response.ok) throw new Error("TRIAL_STORAGE_ERROR");
}

/** The first charge after a trial as Stripe previews it, coupon and tax
 *  included, in minor units; null when Stripe cannot say. */
export async function upcomingCharge(subscriptionId: string): Promise<{ amount: number; currency: string } | null> {
  try {
    const preview = await stripe.invoices.createPreview({ subscription: subscriptionId });
    return { amount: preview.amount_due, currency: preview.currency };
  } catch (error) {
    console.error("could not preview the first charge after a trial:", (error as Error).message);
    return null;
  }
}

/** The subscription a Stripe invoice belongs to, in either API shape. */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parent = (invoice as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } } } }).parent;
  const legacy = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  const ref = parent?.subscription_details?.subscription ?? legacy;
  return (typeof ref === "string" ? ref : ref?.id) ?? null;
}

/** The invoice that ends a trial: the first cycle invoice, its period starting at the trial's end. */
export function endsTrial(invoice: Stripe.Invoice, subscription: Pick<Stripe.Subscription, "trial_end">): boolean {
  if (invoice.billing_reason !== "subscription_cycle" || !subscription.trial_end) return false;
  return invoice.lines.data.some((line) => line.period?.start === subscription.trial_end);
}

/** Ended inside its trial (cancelled, or no payment method at the end), so nothing was ever charged. */
export function endedDuringTrial(subscription: Pick<Stripe.Subscription, "trial_end" | "ended_at" | "canceled_at">, now = Date.now()): boolean {
  if (!subscription.trial_end) return false;
  const ended = subscription.ended_at ?? subscription.canceled_at ?? Math.floor(now / 1000);
  return ended <= subscription.trial_end + 3600;
}
