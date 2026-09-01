import type { IncomingMessage } from "node:http";
import Stripe from "stripe";
import { appUrl, claimStripeEvent, completeStripeEvent, patchAccount, stripe, userForCustomer } from "./_billing.js";
import { formatChargedAmount, notifyOwnerOfSale, sendSubscriptionEmail } from "./_email.js";

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

async function syncSubscription(subscription: Stripe.Subscription, fallbackUserId?: string): Promise<void> {
  const userId = subscription.metadata.redaxa_user_id || fallbackUserId || await userForCustomer(String(subscription.customer));
  if (!userId) {
    // One Stripe account serves several products, and Stripe fans every
    // subscription event out to every endpoint listening for that type. An
    // event we cannot link is another product's, not a lost Redaxa sale, so
    // skip it and return 200: throwing made Stripe retry it forever. Logged
    // in case a genuine orphan ever turns up here.
    console.error("Skipping subscription not linked to a Redaxa account:", subscription.id, JSON.stringify(subscription.metadata));
    return;
  }
  const item = subscription.items.data[0];
  await patchAccount(userId, {
    stripe_customer_id: String(subscription.customer),
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    has_used_trial: true,
    checkout_lock_at: null,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_end: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    plan: subscription.metadata.plan ?? null,
    billing_interval: subscription.metadata.interval ?? item?.price.recurring?.interval ?? null,
    seat_count: item?.quantity ?? 1
  });
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
async function announceSubscription(subscription: Stripe.Subscription): Promise<void> {
  try {
    const item = subscription.items.data[0];
    const price = item?.price;
    const interval = subscription.metadata.interval ?? price?.recurring?.interval ?? null;
    const trialing = subscription.status === "trialing";
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

    const customer = await stripe.customers.retrieve(String(subscription.customer));
    const email = "deleted" in customer && customer.deleted ? null : (customer.email ?? null);
    if (!email) return;
    const firstName = ("name" in customer ? customer.name : null)?.split(" ")[0] ?? null;

    await sendSubscriptionEmail({
      to: email,
      firstName,
      plan: subscription.metadata.plan ?? null,
      interval,
      priceLabel: formatChargedAmount(price?.unit_amount, price?.currency, interval),
      renewsOn,
      trialing,
      appUrl: appUrl(),
    });
    await notifyOwnerOfSale(email, subscription.metadata.plan ?? null, interval, trialing);
  } catch (error) {
    console.error("redaxa subscription announcement failed", String(error).slice(0, 300));
  }
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
      await syncSubscription(subscription);
      if (event.type === "customer.subscription.created") await announceSubscription(subscription);
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata.redaxa_user_id || await userForCustomer(String(subscription.customer));
      if (userId) await patchAccount(userId, { subscription_status: "canceled", cancel_at_period_end: false, current_period_end: null, checkout_lock_at: null });
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const userId = await userForCustomer(String(invoice.customer));
      if (userId) await patchAccount(userId, { subscription_status: "past_due" });
    }
    await completeStripeEvent(event.id);
    response.status(200).json({ received: true });
  } catch {
    response.status(500).json({ error: "Webhook processing failed." });
  }
}
