import type { IncomingMessage } from "node:http";
import Stripe from "stripe";
import { accountFor, appUrl, claimStripeEvent, completeStripeEvent, patchAccount, stripe, supabaseUserById, userForCustomer } from "./_billing.js";
import { formatChargedAmount, notifyOwnerOfSale, sendSubscriptionEmail } from "./_email.js";
import {
  DISPUTE_MARK, TRIAL_REJECTED, cancelRefusedTrial, cardFingerprint, claimTrial, endedDuringTrial, endsTrial, invoiceSubscriptionId,
  isLive, isOurTrial, language, ownsAccount, recordedStatus, upcomingCharge,
} from "./_trial.js";
import { sendTrialMail, type FailureKey, type TrialMailInput, type TrialMailKind } from "./_trial-email.js";
import { ACCOUNT_DELETED } from "./_account-delete.js";

type ResponseLike = { setHeader(name: string, value: string): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };
type WebhookRequest = IncomingMessage & { method?: string; headers: Record<string, string | string[] | undefined> };

export const config = { api: { bodyParser: false } };

function rawBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function resolveUser(subscription: Stripe.Subscription, fallbackUserId?: string): Promise<string | null> {
  return subscription.metadata.redaxa_user_id || fallbackUserId || await userForCustomer(String(subscription.customer));
}

function accountFields(subscription: Stripe.Subscription, status: string) {
  const item = subscription.items.data[0];
  return {
    stripe_customer_id: String(subscription.customer),
    stripe_subscription_id: subscription.id,
    subscription_status: status,
    has_used_trial: true,
    checkout_lock_at: null,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_end: isLive(status) && item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    plan: subscription.metadata.plan ?? null,
    billing_interval: subscription.metadata.interval ?? item?.price.recurring?.interval ?? null,
    seat_count: item?.quantity ?? 1,
  };
}

/**
 * A trial sold under the one-per-person rule keeps it only while it holds the
 * claim for its account, mailbox and card. One that does not is cancelled
 * at once, before anything is charged. Returns whether it may be recorded as
 * a running trial. Idempotent: a replayed event finds its own claim.
 */
async function admitTrial(userId: string, subscription: Stripe.Subscription): Promise<boolean> {
  if (subscription.status !== "trialing" || !isOurTrial(subscription)) return true;
  const email = (await supabaseUserById(userId))?.email;
  if (!email) throw new Error("TRIAL_ACCOUNT_UNKNOWN");
  const claimed = await claimTrial({
    subscriptionId: subscription.id, userId, email, fingerprint: await cardFingerprint(subscription), trialEnd: subscription.trial_end ?? null,
  });
  if (claimed) return true;
  await cancelRefusedTrial(subscription.id);
  console.log(`trial refused for ${subscription.id}: already used; cancelled before any charge`);
  return false;
}

/** Records the subscription against its Redaxa account and returns that
 *  account id, or null when the subscription belongs to another product or
 *  was a refused trial. Callers must treat null as "nothing to announce". */
export async function syncSubscription(subscription: Stripe.Subscription, fallbackUserId?: string): Promise<string | null> {
  const userId = await resolveUser(subscription, fallbackUserId);
  if (!userId) {
    // One Stripe account serves several products, and Stripe fans every
    // subscription event out to every endpoint listening for that type. An
    // event we cannot link is another product's, not a lost Redaxa sale, so
    // skip it and return 200: throwing made Stripe retry it forever. Logged
    // in case a genuine orphan ever turns up here — by id only, since the
    // metadata of another product's subscription may hold its user details.
    console.error("Skipping subscription not linked to a Redaxa account:", subscription.id);
    return null;
  }
  const account = await accountFor(userId);
  if (!(await admitTrial(userId, subscription))) {
    // Someone already in a trial (or subscribed) who opened a second checkout
    // keeps what they have; anyone else sees the refusal and gets told.
    if (ownsAccount(account, { id: subscription.id, status: TRIAL_REJECTED })) {
      await patchAccount(userId, accountFields(subscription, TRIAL_REJECTED));
      await mail("trial_rejected", userId, subscription, `redaxa-trial-rejected/${subscription.id}`);
    }
    return null;
  }
  const status = recordedStatus(subscription);
  // A late event for an old subscription must not end the plan that runs now.
  if (!ownsAccount(account, { id: subscription.id, status })) return userId;
  // Two live subscriptions on one account bill twice: checkout closes earlier
  // sessions to prevent it, so this should never print. If it does, the older
  // one needs cancelling and refunding by hand.
  if (account?.stripe_subscription_id && account.stripe_subscription_id !== subscription.id && isLive(account.subscription_status) && isLive(status)) {
    console.error(`second live Redaxa subscription ${subscription.id} replaces ${account.stripe_subscription_id}: check for a double charge`);
  }
  await patchAccount(userId, accountFields(subscription, status));
  return userId;
}

/** "insufficient_funds" and friends, from the payment Stripe last tried on the invoice. */
async function failureOf(invoice: Stripe.Invoice): Promise<FailureKey | null> {
  try {
    const full = await stripe.invoices.retrieve(invoice.id!, { expand: ["payments.data.payment.payment_intent"] });
    const payments = (full as unknown as { payments?: { data?: Array<{ payment?: { payment_intent?: Stripe.PaymentIntent | string } }> } }).payments?.data ?? [];
    const intent = payments.map((p) => p.payment?.payment_intent).find((pi): pi is Stripe.PaymentIntent => typeof pi === "object" && pi !== null);
    // A card that needs 3-D Secure off-session leaves the payment waiting for
    // the bank with no error recorded on it.
    if (intent?.status === "requires_action") return "authentication_required";
    const error = intent?.last_payment_error;
    const code = error?.decline_code ?? error?.code ?? null;
    if (!code) return null;
    if (code === "insufficient_funds") return "insufficient_funds";
    if (code === "expired_card") return "expired_card";
    if (code === "authentication_required") return "authentication_required";
    if (code === "processing_error") return "processing_error";
    if (["card_declined", "generic_decline", "do_not_honor", "lost_card", "stolen_card", "fraudulent"].includes(code)) return "card_declined";
    return "generic";
  } catch {
    return null;
  }
}

/** Builds and sends one trial email for a subscription. Never throws. */
async function mail(kind: TrialMailKind, userId: string, subscription: Stripe.Subscription, key: string, extra: Partial<TrialMailInput> = {}): Promise<void> {
  try {
    const customer = await stripe.customers.retrieve(String(subscription.customer));
    const deleted = "deleted" in customer && customer.deleted;
    const to = (!deleted ? customer.email : null) ?? (await supabaseUserById(userId))?.email ?? null;
    if (!to) return;
    const item = subscription.items.data[0];
    const price = item?.price;
    const trialDays = subscription.trial_start && subscription.trial_end ? Math.round((subscription.trial_end - subscription.trial_start) / 86_400) : 3;
    await sendTrialMail(kind, {
      to,
      firstName: (!deleted && "name" in customer ? customer.name : null)?.split(" ")[0] ?? null,
      lang: language(subscription.metadata.lang),
      plan: subscription.metadata.plan ?? null,
      interval: subscription.metadata.interval ?? price?.recurring?.interval ?? null,
      seats: item?.quantity ?? 1,
      days: trialDays,
      trialEnd: subscription.trial_end ?? null,
      renew: price?.unit_amount != null ? { amount: price.unit_amount * (item?.quantity ?? 1), currency: price.currency, taxExclusive: price.tax_behavior !== "inclusive" /* unspecified = the account default, exclusive */ } : null,
      consented: Boolean(subscription.metadata.consent_id),
      ...extra,
    }, key);
  } catch (error) {
    console.error(`redaxa ${kind} mail could not be prepared`, String(error).slice(0, 300));
  }
}

/**
 * Tells the customer their subscription has begun, and tells the owner a sale
 * happened. Neither existed before: the webhook recorded the subscription and
 * nobody was told anything.
 *
 * Sent from `customer.subscription.created` only, which fires exactly once
 * per subscription — `updated` fires on every renewal and every card change,
 * and mailing on those would turn a welcome into spam.
 *
 * Deliberately swallows its own failures. Throwing would make Stripe retry
 * the whole webhook and re-run the account sync that already succeeded, and
 * the customer's access does not depend on an email arriving.
 */
/** A once-only coupon is gone from the subscription by the time this email is
 *  written, so the promotion's metadata is how it knows to say so. */
export function promoLabel(label: string | null, promoId: string | undefined): string | null {
  return label && promoId ? `${label} (first payment discounted)` : label;
}

async function announceSubscription(userId: string, subscription: Stripe.Subscription): Promise<void> {
  try {
    const item = subscription.items.data[0];
    const price = item?.price;
    const interval = subscription.metadata.interval ?? price?.recurring?.interval ?? null;
    const trialing = subscription.status === "trialing";
    const customer = await stripe.customers.retrieve(String(subscription.customer));
    const email = "deleted" in customer && customer.deleted ? null : (customer.email ?? null);
    if (!email) return;
    if (trialing && isOurTrial(subscription)) {
      // The first charge as Stripe will take it, coupon and tax included.
      await mail("trial_started", userId, subscription, `redaxa-trial-started/${subscription.id}`, { charge: await upcomingCharge(subscription.id) });
    } else {
      if (!trialing) {
        // What the first invoice really took (a once-only coupon included); the renewal comes from the Price.
        const invoiceId = typeof subscription.latest_invoice === "string" ? subscription.latest_invoice : subscription.latest_invoice?.id;
        const paid = invoiceId ? await stripe.invoices.retrieve(invoiceId).catch(() => null) : null;
        await mail("subscription_started", userId, subscription, `redaxa-subscription/${subscription.id}`, {
          charge: paid && paid.amount_paid > 0 ? { amount: paid.amount_paid, currency: paid.currency } : null,
          renewsOn: item?.current_period_end ?? null,
        });
      } else {
      // During a trial the meaningful date is the first charge, not a renewal;
      // trial_end carries it, and the period end carries the other case.
      const dateSeconds = trialing ? subscription.trial_end : item?.current_period_end;
      const renewsOn = dateSeconds
        ? new Date(dateSeconds * 1000).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })
        : null;
      const firstName = ("name" in customer ? customer.name : null)?.split(" ")[0] ?? null;

      await sendSubscriptionEmail({
        to: email,
        firstName,
        plan: subscription.metadata.plan ?? null,
        interval,
        priceLabel: promoLabel(formatChargedAmount(price?.unit_amount, price?.currency, interval), subscription.metadata.promo_id),
        renewsOn,
        trialing,
        appUrl: appUrl(),
      }, `redaxa-subscription/${subscription.id}`);
      }
    }
    await notifyOwnerOfSale(email, subscription.metadata.plan ?? null, interval, trialing, `redaxa-sale/${subscription.id}`);
  } catch (error) {
    console.error("redaxa subscription announcement failed", String(error).slice(0, 300));
  }
}

/** Invoice outcomes move the subscription (trial converted, renewal failed,
 *  retry succeeded): re-read it and apply the same rules, then say what
 *  happened: a trial's first charge, or any failed renewal. */
async function handleInvoice(type: string, invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = await syncSubscription(subscription);
  if (!userId) return;
  if (type === "invoice.paid" && isOurTrial(subscription) && endsTrial(invoice, subscription)) {
    const period = invoice.lines.data.find((line) => line.period?.start === subscription.trial_end)?.period;
    await mail("trial_paid", userId, subscription, `redaxa-trial-paid/${invoice.id}`, {
      charge: { amount: invoice.amount_paid, currency: invoice.currency },
      renewsOn: period?.end ?? subscription.items.data[0]?.current_period_end ?? null,
    });
  }
  // Once per invoice: Stripe retries a failed charge and reports each attempt.
  // Every failed renewal, not only a trial's first charge: past_due already
  // turns Pro off (hasActiveEntitlement), so the customer must hear why.
  const renewal = isOurTrial(subscription) || invoice.billing_reason === "subscription_cycle";
  if (type === "invoice.payment_failed" && renewal && (invoice.attempt_count ?? 1) <= 1 && !["active", "trialing"].includes(subscription.status)) {
    await mail("payment_failed", userId, subscription, `redaxa-payment-failed/${invoice.id}`, {
      charge: { amount: invoice.amount_due, currency: invoice.currency },
      failure: await failureOf(invoice),
    });
  }
}

/** Cancellation comment Stripe keeps on a subscription ended because a
 *  payment for it was disputed or refunded in full: the record of why. */
export const PAYMENT_REVERSED = "payment_reversed";

/** The subscription a charge paid for, through the invoice it settled; null
 *  for a payment that settled no subscription invoice (a tip, another product). */
async function subscriptionOfCharge(charge: string | Stripe.Charge, paymentIntent: string | Stripe.PaymentIntent | null): Promise<string | null> {
  let intent = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id ?? null;
  if (!intent) {
    const full = typeof charge === "string" ? await stripe.charges.retrieve(charge) : charge;
    intent = typeof full.payment_intent === "string" ? full.payment_intent : full.payment_intent?.id ?? null;
  }
  if (!intent) return null;
  const payments = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: intent }, limit: 1 });
  const ref = payments.data[0]?.invoice;
  if (!ref) return null;
  const invoice = typeof ref === "string" ? await stripe.invoices.retrieve(ref) : ref;
  return "deleted" in invoice && invoice.deleted ? null : invoiceSubscriptionId(invoice as Stripe.Invoice);
}

/**
 * A subscription payment refunded in full, or a dispute lost: the
 * subscription is cancelled at once (no final invoice, no proration), the
 * plan is switched off and the customer is told in neutral words.
 *
 * Idempotent: the event claim runs it once; a retry after a failure writes
 * the same account row and finds the subscription already cancelled. The
 * account is switched off first, so a failure before Stripe answers leaves
 * nothing half done. Told once: only the reversal that ended a live plan
 * mails. A reversal on an old subscription never ends a newer one the
 * account holds.
 */
async function reversePayment(subscriptionId: string, reversed: { amount: number; currency: string }, reason: string): Promise<void> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = await resolveUser(subscription);
  if (!userId) return;
  const account = await accountFor(userId);
  // The plan the account runs on now; an older, duplicate subscription is
  // cancelled below but its owner keeps the plan and hears nothing.
  const current = account?.stripe_subscription_id === subscription.id;
  if (current && account.subscription_status !== "canceled") {
    await patchAccount(userId, { subscription_status: "canceled", cancel_at_period_end: false, current_period_end: null, checkout_lock_at: null });
  }
  if (!isLive(subscription.status)) return;
  try {
    await stripe.subscriptions.cancel(subscription.id, { cancellation_details: { comment: PAYMENT_REVERSED } });
  } catch (error) {
    if ((await stripe.subscriptions.retrieve(subscription.id)).status !== "canceled") throw error;
  }
  console.log(`redaxa payment reversed (${reason}): subscription ${subscription.id} cancelled${current ? ", plan off" : ""}`);
  if (current) await mail("payment_reversed", userId, subscription, `redaxa-payment-reversed/${subscription.id}`, { charge: reversed });
}

/** Dispute statuses that leave the payment with us. Anything else not lost
 *  (needs_response, under_review, the warning_* inquiries, a status Stripe
 *  adds later) counts as open, so access is held rather than given. */
const DISPUTE_CLEARED = new Set(["won", "warning_closed", "prevented"]);

/** Where the disputes on this charge stand now, read from Stripe rather than
 *  from the event, so retries and events delivered out of order (closed
 *  before created) land on the same answer. A key without Disputes read
 *  falls back to the event's own dispute. */
async function disputeOutcome(dispute: Stripe.Dispute): Promise<"open" | "lost" | "cleared"> {
  const charge = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
  let all: Stripe.Dispute[] = [dispute];
  try {
    all = (await stripe.disputes.list({ charge, limit: 100 })).data;
    if (!all.some((d) => d.id === dispute.id)) throw new Error("DISPUTE_NOT_LISTED_YET");
  } catch (error) {
    if ((error as { type?: string }).type !== "StripePermissionError") throw error;
    console.error("redaxa: the Stripe key cannot read disputes; using the event's own status");
  }
  if (all.some((d) => d.status === "lost")) return "lost";
  return all.every((d) => DISPUTE_CLEARED.has(d.status)) ? "cleared" : "open";
}

/**
 * A disputed subscription payment. While the dispute is open the plan is off
 * and renewals are paused (pause_collection, reversible, accepted under
 * Managed Payments), marked on the subscription so every later sync keeps it
 * off. Won: the pause and the mark go and the plan comes back by itself.
 * Lost: cancelled for good, as for a full refund. Nothing is mailed while it
 * is open or when it is won; the lost case sends the payment-reversed notice.
 */
async function settleDispute(dispute: Stripe.Dispute): Promise<void> {
  const subscriptionId = await subscriptionOfCharge(dispute.charge, dispute.payment_intent);
  if (!subscriptionId) return;
  const outcome = await disputeOutcome(dispute);
  if (outcome === "lost") {
    await reversePayment(subscriptionId, { amount: dispute.amount, currency: dispute.currency }, "dispute lost");
    return;
  }
  let subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!isLive(subscription.status)) return; // ended already: nothing to hold or give back
  const marked = Boolean(subscription.metadata?.[DISPUTE_MARK]);
  if (outcome === "open" && (!marked || !subscription.pause_collection)) {
    const charge = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
    subscription = await stripe.subscriptions.update(subscription.id, { pause_collection: { behavior: "void" }, metadata: { [DISPUTE_MARK]: charge } });
  } else if (outcome === "cleared" && marked) {
    subscription = await stripe.subscriptions.update(subscription.id, { pause_collection: "", metadata: { [DISPUTE_MARK]: "" } });
  }
  await syncSubscription(subscription);
  console.log(`redaxa dispute ${dispute.id}: ${outcome}, subscription ${subscription.id} ${outcome === "open" ? "held" : "running"}`);
}

export default async function handler(request: WebhookRequest, response: ResponseLike): Promise<void> {
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
  const signatureHeader = request.headers["stripe-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) { response.status(400).json({ error: "Webhook signature is missing." }); return; }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await rawBody(request), signature, secret);
  } catch {
    response.status(400).json({ error: "Invalid webhook signature." }); return;
  }
  try {
    const claim = await claimStripeEvent(event.id, event.type);
    if (claim === "completed") { response.status(200).json({ received: true, duplicate: true }); return; }
    if (claim === "in_progress") { response.status(500).json({ error: "Event is being processed." }); return; }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
        await syncSubscription(subscription, session.metadata?.redaxa_user_id);
      }
    } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const eventSubscription = event.data.object as Stripe.Subscription;
      const subscription = await stripe.subscriptions.retrieve(eventSubscription.id);
      const userId = await syncSubscription(subscription);
      // Only announce what syncSubscription could actually claim. This used
      // to fire on every subscription in the account, so a PC Tweaker sale
      // mailed its buyer a Redaxa welcome and reported a Redaxa sale that
      // never happened.
      if (userId && event.type === "customer.subscription.created" && ["trialing", "active"].includes(subscription.status)) await announceSubscription(userId, subscription);
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await resolveUser(subscription);
      if (userId) {
        const status = recordedStatus(subscription);
        // A refused second trial or an old subscription ending must not end the one that runs.
        if (ownsAccount(await accountFor(userId), { id: subscription.id, status })) {
          await patchAccount(userId, { subscription_status: status === TRIAL_REJECTED ? TRIAL_REJECTED : "canceled", cancel_at_period_end: false, current_period_end: null, checkout_lock_at: null });
        }
        // An account deletion sends its own confirmation; the account is gone.
        // A reversed payment sends its own notice too.
        const comment = subscription.cancellation_details?.comment;
        if (isOurTrial(subscription) && status !== TRIAL_REJECTED && comment !== ACCOUNT_DELETED && comment !== PAYMENT_REVERSED && endedDuringTrial(subscription)) {
          await mail("trial_ended", userId, subscription, `redaxa-trial-ended/${subscription.id}`, { endedOn: subscription.ended_at ?? subscription.trial_end ?? null });
        }
      }
    } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required") {
      // Stripe's current subscription state decides, not the event: a failed
      // invoice processed after the payment recovered must not lock out a
      // paying account, and an invoice for another product changes nothing.
      await handleInvoice(event.type, event.data.object as Stripe.Invoice);
    } else if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
      await settleDispute(event.data.object as Stripe.Dispute);
    } else if (event.type === "charge.refunded") {
      // Only a full refund ends the plan; a partial one leaves it running.
      const charge = event.data.object as Stripe.Charge;
      if (charge.refunded) {
        const subscriptionId = await subscriptionOfCharge(charge, charge.payment_intent);
        if (subscriptionId) await reversePayment(subscriptionId, { amount: charge.amount_refunded, currency: charge.currency }, "refund");
      }
    }
    await completeStripeEvent(event.id);
    response.status(200).json({ received: true });
  } catch {
    response.status(500).json({ error: "Webhook processing failed." });
  }
}
