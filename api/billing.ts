import { accountFor, appUrl, corsHeaders, parseJson, releaseCheckout, requireUser, reserveCheckout, saveCustomer, stripe } from "./_billing.js";
import { clientIp, rateLimited } from "./_rateLimit.js";

type RequestLike = { method?: string; body?: unknown; query?: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

// Consolidated with the portal action (Vercel's Hobby plan caps a deployment
// at 12 serverless functions): ?action=portal opens the Stripe billing
// portal, anything else starts a checkout session.
const priceFor = (plan: string, interval: string): string | null => {
  const prices: Record<string, string | undefined> = {
    "personal:monthly": process.env.STRIPE_PRICE_PERSONAL_MONTHLY,
    "personal:yearly": process.env.STRIPE_PRICE_PERSONAL_YEARLY,
    "business:monthly": process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
    "business:yearly": process.env.STRIPE_PRICE_BUSINESS_YEARLY
  };
  return prices[`${plan}:${interval}`] ?? null;
};

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }

  const action = Array.isArray(request.query?.action) ? request.query?.action[0] : request.query?.action;

  if (action === "portal") {
    try {
      const user = await requireUser(request, response);
      const account = await accountFor(user.id);
      if (!account?.stripe_customer_id) { response.status(400).json({ error: "No subscription is attached to this account yet." }); return; }
      const session = await stripe.billingPortal.sessions.create({ customer: account.stripe_customer_id, return_url: `${appUrl()}/?billing=managed` });
      response.status(200).json({ url: session.url });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PORTAL_ERROR";
      response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not open billing management." });
    }
    return;
  }

  try {
    const user = await requireUser(request, response);
    if (rateLimited(`checkout:user:${user.id}`, 10, 15 * 60_000) || rateLimited(`checkout:ip:${clientIp(request.headers)}`, 30, 15 * 60_000)) {
      response.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
      return;
    }
    const body = parseJson(request.body);
    const plan = body.plan === "business" ? "business" : body.plan === "personal" ? "personal" : null;
    const interval = body.interval === "yearly" ? "yearly" : body.interval === "monthly" ? "monthly" : null;
    const seats = plan === "business" && Number.isInteger(body.seats) ? Number(body.seats) : 1;
    const price = plan && interval ? priceFor(plan, interval) : null;
    if (!plan || !interval || !price || seats < 1 || seats > 3) { response.status(400).json({ error: "Invalid plan selection." }); return; }

    const account = await reserveCheckout(user.id);
    let customerId = account.stripe_customer_id;
    try {
      if (!customerId) {
        const customer = await stripe.customers.create({ email: user.email, metadata: { promptshield_user_id: user.id } }, { idempotencyKey: `ps-customer-${user.id}` });
        customerId = customer.id;
        await saveCustomer(user.id, customerId);
      }
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price, quantity: seats }],
        allow_promotion_codes: interval === "monthly",
        subscription_data: {
          trial_period_days: account.has_used_trial ? undefined : 7,
          metadata: { promptshield_user_id: user.id, plan, interval, seats: String(seats) }
        },
        metadata: { promptshield_user_id: user.id, plan, interval, seats: String(seats) },
        success_url: `${appUrl()}/?checkout=success`,
        cancel_url: `${appUrl()}/?checkout=cancelled`
      }, { idempotencyKey: `ps-checkout-${user.id}-${Date.now()}` });
      response.status(200).json({ url: session.url });
    } catch (error) {
      await releaseCheckout(user.id);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "CHECKOUT_ERROR";
    const status = message === "UNAUTHORIZED" ? 401 : message === "ACTIVE_SUBSCRIPTION" ? 409 : message === "CHECKOUT_IN_PROGRESS" ? 429 : 500;
    response.status(status).json({ error: status === 500 ? "We could not start checkout. Please try again." : message });
  }
}
