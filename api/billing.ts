import { DESKTOP_ORIGINS, accountFor, billingAppUrl, corsHeaders, parseJson, releaseCheckout, requireUser, reserveCheckout, saveCustomer, stripe, supabaseUserById } from "./_billing.js";
import { clientIp, rateLimited } from "./_rateLimit.js";
import { promoCheckout, promoState } from "./_promo.js";
import {
  LEGACY_TRIAL_DAYS, LEGACY_TRIAL_MARK, LANGUAGES, TRIAL_DAYS, TRIAL_MARK, dueReminders, isLive, isOurTrial, markReminded, publicPrices,
  legacyTrialEligible, trialEligible, upcomingCharge, language as languageOf,
} from "./_trial.js";
import { sendTrialMail } from "./_trial-email.js";

type RequestLike = { method?: string; body?: unknown; query?: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

// Consolidated with the portal action (Vercel's Hobby plan caps a deployment
// at 12 serverless functions): ?action=portal opens the Stripe billing
// portal, GET ?action=promo publishes the current offer, GET ?action=prices
// the plan prices as Stripe has them, the cron sweep sends trial reminders,
// anything else starts a checkout session.
const priceFor = (plan: string, interval: string): string | null => {
  const prices: Record<string, string | undefined> = {
    "personal:monthly": process.env.STRIPE_PRICE_PERSONAL_MONTHLY,
    "personal:yearly": process.env.STRIPE_PRICE_PERSONAL_YEARLY,
    "business:monthly": process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
    "business:yearly": process.env.STRIPE_PRICE_BUSINESS_YEARLY
  };
  return prices[`${plan}:${interval}`] ?? null;
};

const PORTAL_MARK = "redaxa-portal-v1";
let portalConfigurationId: Promise<string | undefined> | null = null;

/**
 * Redaxa's own customer-portal configuration: cancel at period end, card,
 * invoices. The account's default configuration is shared with the other
 * products sold through the same Stripe account and offers their prices as
 * "plan changes", which would move a Redaxa subscriber onto another
 * product's price. No plan changes here: plan and seats come from checkout.
 * Found by its metadata, created the first time; STRIPE_PORTAL_CONFIGURATION
 * overrides. Undefined (the account default, as before) when Stripe refuses.
 */
export function portalConfiguration(): Promise<string | undefined> {
  const configured = process.env.STRIPE_PORTAL_CONFIGURATION;
  if (configured?.startsWith("bpc_")) return Promise.resolve(configured);
  portalConfigurationId ??= (async () => {
    const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
    const found = existing.data.find((configuration) => configuration.metadata?.redaxa === PORTAL_MARK);
    if (found) return found.id;
    const created = await stripe.billingPortal.configurations.create({
      business_profile: { headline: "Manage your Redaxa subscription" },
      features: {
        customer_update: { enabled: true, allowed_updates: ["name", "email", "address", "phone"] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
        subscription_update: { enabled: false },
      },
      metadata: { redaxa: PORTAL_MARK },
    });
    return created.id;
  })().catch((error: unknown) => {
    console.error("no Redaxa portal configuration, using the account default:", String((error as Error)?.message ?? error).slice(0, 200));
    portalConfigurationId = null;
    return undefined;
  });
  return portalConfigurationId;
}

/**
 * The reminder a day before a trial ends. Vercel Cron calls this four times a
 * day with `Authorization: Bearer $CRON_SECRET`; without the secret it does
 * nothing. Each reminder is re-checked against Stripe first, so a trial that
 * was cancelled, converted or moved is skipped, and it is marked as sent only
 * once the mail went out (the next run retries otherwise).
 */
export async function sendTrialReminders(now = Date.now()): Promise<{ due: number; sent: number }> {
  let sent = 0;
  const due = await dueReminders(now);
  for (const claim of due) {
    try {
      const subscription = await stripe.subscriptions.retrieve(claim.subscription_id);
      const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;
      if (!isOurTrial(subscription) || subscription.status !== "trialing" || subscription.cancel_at_period_end || !trialEnd || Date.parse(trialEnd) !== Date.parse(claim.trial_end)) continue;
      const customer = await stripe.customers.retrieve(String(subscription.customer));
      const deleted = "deleted" in customer && customer.deleted;
      const to = (!deleted ? customer.email : null) ?? (await supabaseUserById(claim.user_id))?.email;
      if (!to) continue;
      const item = subscription.items.data[0];
      const price = item?.price;
      const ok = await sendTrialMail("trial_ending", {
        to,
        firstName: (!deleted && "name" in customer ? customer.name : null)?.split(" ")[0] ?? null,
        lang: languageOf(subscription.metadata.lang),
        plan: subscription.metadata.plan ?? null,
        interval: subscription.metadata.interval ?? price?.recurring?.interval ?? null,
        seats: item?.quantity ?? 1,
        days: subscription.trial_start && subscription.trial_end ? Math.round((subscription.trial_end - subscription.trial_start) / 86_400) : TRIAL_DAYS,
        trialEnd: subscription.trial_end,
        charge: await upcomingCharge(subscription.id),
        renew: price?.unit_amount != null ? { amount: price.unit_amount * (item?.quantity ?? 1), currency: price.currency, taxExclusive: price.tax_behavior !== "inclusive" } : null,
      }, `redaxa-trial-ending/${subscription.id}/${subscription.trial_end}`);
      if (ok) { await markReminded(subscription.id, trialEnd); sent += 1; }
    } catch (error) {
      console.error("trial reminder failed for", claim.subscription_id, String(error).slice(0, 200));
    }
  }
  return { due: due.length, sent };
}

/**
 * One payable checkout per account. The reservation lasts ten minutes but a
 * Checkout session stays payable for 24 hours, so an older one left open in
 * another tab or app could be paid next to the new one: two subscriptions,
 * two charges. It is closed first. A session already paid whose subscription
 * the webhook has not recorded yet (seconds, or a delayed payment method)
 * stops the new checkout instead.
 */
export async function closeEarlierCheckouts(customerId: string, userId: string, recorded: string | null, now = Date.now()): Promise<void> {
  const mine = (session: { metadata?: Record<string, string> | null }) => session.metadata?.redaxa_user_id === userId;
  const completed = await stripe.checkout.sessions.list({ customer: customerId, status: "complete", created: { gte: Math.floor(now / 1000) - 86_400 }, limit: 20 });
  for (const session of completed.data) {
    const id = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (!mine(session) || session.mode !== "subscription" || !id || id === recorded) continue;
    if (isLive((await stripe.subscriptions.retrieve(id)).status)) throw new Error("CHECKOUT_COMPLETING");
  }
  const open = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 20 });
  for (const session of open.data) if (mine(session)) await stripe.checkout.sessions.expire(session.id);
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  const action = Array.isArray(request.query?.action) ? request.query?.action[0] : request.query?.action;
  // Public and uncached: the site and apps draw the offer and its countdown
  // from this, and checkout below applies it from the same clock.
  if (request.method === "GET" && action === "promo") {
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(promoState());
    return;
  }
  // Public: the plan prices as Stripe has them (cached ten minutes), whether
  // the trial is offered and how long it lasts. No page writes a price itself.
  if (request.method === "GET" && action === "prices") {
    response.setHeader("Cache-Control", "public, max-age=300");
    response.status(200).json(await publicPrices());
    return;
  }
  if (request.method === "GET" && (action === "trial-reminders" || request.headers?.["x-vercel-cron-schedule"] !== undefined)) {
    response.setHeader("Cache-Control", "no-store");
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers?.authorization !== `Bearer ${secret}`) { response.status(401).json({ error: "UNAUTHORIZED" }); return; }
    try {
      // Also makes the portal configuration exist before a customer needs it.
      await portalConfiguration();
      response.status(200).json(await sendTrialReminders());
    } catch (error) {
      console.error("trial reminder sweep failed:", String(error).slice(0, 300));
      response.status(500).json({ error: "Reminder sweep failed." });
    }
    return;
  }
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }

  if (action === "portal") {
    try {
      const user = await requireUser(request, response);
      const account = await accountFor(user.id);
      if (!account?.stripe_customer_id) { response.status(400).json({ error: "No subscription is attached to this account yet." }); return; }
      const session = await stripe.billingPortal.sessions.create({ customer: account.stripe_customer_id, configuration: await portalConfiguration(), return_url: `${billingAppUrl(request)}/?billing=managed` });
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
    // The customer's choice: "Start 3-day free trial" (true) or "Subscribe
    // now" (false). Absent: a page showing no choice, or the Windows app 0.5.5 and older.
    const startTrial = body.start_trial;
    if (startTrial !== undefined && typeof startTrial !== "boolean") { response.status(400).json({ error: "start_trial must be true or false." }); return; }
    // Only to word the emails in the language the customer was using.
    const lang = LANGUAGES.includes(body.language as never) ? languageOf(body.language) : null;
    // Asked for by the customer, granted by the server; the claim recorded
    // when Stripe creates the subscription decides last.
    if (startTrial === true && !(await trialEligible(user.id, user.email, await accountFor(user.id)))) {
      response.status(409).json({ error: "The free trial is not available for this account. Subscribe now instead.", code: "trial_unavailable" });
      return;
    }

    let account;
    try {
      account = await reserveCheckout(user.id);
    } catch (error) {
      // Changing one's mind (Subscribe now, back, Start trial) is the normal
      // path for clients that offer the choice: the checkout still open is
      // closed and replaced, so only the latest one can be paid. Clients from
      // before the choice keep the ten-minute wait they know.
      if (!(error instanceof Error && error.message === "CHECKOUT_IN_PROGRESS") || startTrial === undefined) throw error;
      await releaseCheckout(user.id);
      account = await reserveCheckout(user.id);
    }
    let customerId = account.stripe_customer_id;
    try {
      if (customerId) await closeEarlierCheckouts(customerId, user.id, account.stripe_subscription_id);
      if (!customerId) {
        const customer = await stripe.customers.create({ email: user.email, metadata: { redaxa_user_id: user.id } }, { idempotencyKey: `ps-customer-${user.id}` });
        customerId = customer.id;
        await saveCustomer(user.id, customerId);
      }
      // No choice sent: a page that could not read the offer (it shows one
      // "Go Pro" button) or the Windows app 0.5.5 and older, which never
      // offers one. An eligible new subscriber still gets the trial, always
      // under the one-per-person rule: the mark makes the webhook claim it
      // against the account, the mailbox and the card. It lasts three days,
      // like every other trial, except for that old app, whose screens and
      // terms promise seven: it is the only client that calls from the
      // desktop app's origin without `language`, which arrived with the
      // choice in 0.6.0.
      const automatic = startTrial === undefined && await legacyTrialEligible(user.id, user.email, account);
      const origin = Array.isArray(request.headers?.origin) ? request.headers.origin[0] : request.headers?.origin;
      const oldApp = body.language === undefined && DESKTOP_ORIGINS.has(origin ?? "");
      const trial = startTrial === true || (automatic && !oldApp)
        ? { days: TRIAL_DAYS, mark: TRIAL_MARK }
        : automatic ? { days: LEGACY_TRIAL_DAYS, mark: LEGACY_TRIAL_MARK } : null;
      // The discount follows the plan resolved above and the server's clock.
      // A once-only coupon skips the trial's zero invoice and comes off the
      // first paid one (checked on Stripe test clocks, 10 and 14 Oct 2026).
      const promo = promoCheckout(process.env, Date.now(), plan, interval, seats);
      const metadata = {
        redaxa_user_id: user.id, plan, interval, seats: String(seats),
        ...(promo ? { promo_id: promo.id } : {}),
        ...(trial?.mark ? { trial: trial.mark } : {}),
        ...(lang ? { lang } : {}),
      };
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        // Not passing payment_method_types: this Stripe account has Managed
        // Payments on (the newer default), which rejects an explicit list
        // and picks methods itself.
        line_items: [{ price, quantity: seats }],
        // Checkout refuses promotion codes alongside a discount.
        ...(promo
          ? { discounts: [{ coupon: promo.coupon }], ...(promo.expiresAt ? { expires_at: promo.expiresAt } : {}) }
          : { allow_promotion_codes: interval === "monthly" }),
        // A card or another recurring method before the trial starts; with
        // none left at the end, the subscription cancels itself unpaid.
        ...(trial?.mark ? { payment_method_collection: "always" as const } : {}),
        subscription_data: {
          trial_period_days: trial?.days,
          ...(trial?.mark ? { trial_settings: { end_behavior: { missing_payment_method: "cancel" as const } } } : {}),
          metadata
        },
        metadata,
        success_url: `${billingAppUrl(request)}/?checkout=success`,
        cancel_url: `${billingAppUrl(request)}/?checkout=cancelled`
      }, { idempotencyKey: `ps-checkout-${user.id}-${Date.now()}` });
      response.status(200).json({ url: session.url, trial: Boolean(trial), trialDays: trial?.days ?? null });
    } catch (error) {
      await releaseCheckout(user.id);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "CHECKOUT_ERROR";
    // An unpaid, paused or incomplete subscription still exists and can bill:
    // a second one would charge twice once the card is fixed. The customer
    // settles the first one in Manage billing instead.
    if (message === "CHECKOUT_COMPLETING") {
      response.status(409).json({ error: "Your last payment is still being confirmed. Give it a minute, then refresh your plan.", code: "payment_processing" });
      return;
    }
    if (message === "BILLING_ACTION_REQUIRED") {
      response.status(409).json({ error: "Your subscription has a payment to sort out. Update it in Manage billing instead of starting a new one.", code: "manage_billing" });
      return;
    }
    const status = message === "UNAUTHORIZED" ? 401 : message === "ACTIVE_SUBSCRIPTION" ? 409 : message === "CHECKOUT_IN_PROGRESS" ? 429 : 500;
    if (status === 500) console.error("billing checkout error:", error);
    response.status(status).json({ error: status === 500 ? "We could not start checkout. Please try again." : message });
  }
}
