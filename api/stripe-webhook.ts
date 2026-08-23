import type { IncomingMessage } from "node:http";
import Stripe from "stripe";
import { claimStripeEvent, completeStripeEvent, patchAccount, stripe, userForCustomer } from "./_billing.js";

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
  if (!userId) throw new Error("Subscription cannot be linked to an account.");
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
      await syncSubscription(await stripe.subscriptions.retrieve(eventSubscription.id));
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
