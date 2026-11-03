import { randomUUID } from "node:crypto";
import { DESKTOP_ORIGINS, accountFor, appUrl, effectiveEntitlement, patchAccount, billingAppUrl, corsHeaders, parseJson, releaseCheckout, requireUser, reserveCheckout, saveCustomer, stripe, supabaseService, supabaseUserById, type BillingUser } from "./_billing.js";
import { clientAddress, clientIp, rateLimited } from "./_rateLimit.js";
import { TERMS_VERSION, attachSession, consentPage, consentRequired, openIntent, purgeConsents, recordConsent, sealIntent, userAgentFamily, type ConsentRow, type PageError, type PageInput } from "./_consent.js";
import { promoCheckout, promoState } from "./_promo.js";
import {
  LEGACY_TRIAL_DAYS, LEGACY_TRIAL_MARK, LANGUAGES, TRIAL_DAYS, TRIAL_MARK, dueReminders, isLive, isOurTrial, markReminded, publicPrices,
  legacyTrialEligible, trialEligible, upcomingCharge, language as languageOf, type Language,
} from "./_trial.js";
import { sendCheckoutRecovery } from "./_checkout-recovery.js";
import { sendTrialMail } from "./_trial-email.js";
import { SubscriptionError, cancelFeedback, setCancelAtPeriodEnd, subscriptionState, type SubscriptionDeps } from "./_subscription.js";
import { notifyOwnerOfCancellation } from "./_email.js";
import type Stripe from "stripe";

type RequestLike = { method?: string; body?: unknown; query?: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(body?: string): void };

// Consolidated with the portal action (Vercel's Hobby plan caps a deployment
// at 12 serverless functions): ?action=portal opens the Stripe billing
// portal, GET ?action=promo publishes the current offer, GET ?action=prices
// the plan prices as Stripe has them, the cron sweep sends trial reminders
// and the one "your payment didn't go through" email (_checkout-recovery.ts),
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

/** api/_subscription.ts on the live Stripe client and billing tables. */
const subscriptionDeps: SubscriptionDeps = {
  accountFor,
  memberOf: async (userId) => { const e = await effectiveEntitlement(userId); return e.role === "member" ? e.ownerEmail : null; },
  retrieve: (id) => stripe.subscriptions.retrieve(id, { expand: ["default_payment_method"] }),
  update: (id, params) => stripe.subscriptions.update(id, { ...params, expand: ["default_payment_method"] }),
  customerCard: async (customerId) => {
    const customer = await stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
    if ("deleted" in customer && customer.deleted) return null;
    const method = customer.invoice_settings?.default_payment_method;
    return method && typeof method !== "string" && method.card ? { brand: method.card.brand, last4: method.card.last4 } : null;
  },
  patchAccount,
  portalCancelUrl: async (customerId, subscriptionId) => (await stripe.billingPortal.sessions.create({
    customer: customerId, configuration: await portalConfiguration(),
    flow_data: { type: "subscription_cancel", subscription_cancel: { subscription: subscriptionId } },
  })).url,
  notifyCancellation: async (notice) => {
    const customer = await stripe.customers.retrieve(notice.customerId).catch(() => null);
    const live = customer && !("deleted" in customer && customer.deleted) ? customer as Stripe.Customer : null;
    return notifyOwnerOfCancellation({ ...notice, email: live?.email ?? null, country: live?.address?.country ?? null }, `redaxa-cancel/${notice.subscriptionId}/${notice.endsAt ?? ""}`);
  },
};

/** GET ?action=subscription, POST ?action=subscription-cancel|subscription-resume
 *  (vercel.json maps /api/billing/subscription[/cancel|/resume] here). */
async function subscriptionAction(action: string, request: RequestLike, response: ResponseLike): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  try {
    const user = await requireUser(request, response);
    if (action === "subscription") { response.status(200).json(await subscriptionState(user.id, subscriptionDeps)); return; }
    if (rateLimited(`subscription:user:${user.id}`, 10, 15 * 60_000) || rateLimited(`subscription:ip:${clientIp(request.headers)}`, 30, 15 * 60_000)) {
      response.setHeader("Retry-After", "900");
      response.status(429).json({ error: "rate_limited", code: "rate_limited", message: "Too many attempts. Please wait a few minutes and try again." });
      return;
    }
    const cancel = action === "subscription-cancel";
    // The optional "why" of the cancel dialog; validated before Stripe is touched.
    const feedback = cancel ? cancelFeedback(request.body) : undefined;
    response.status(200).json(await setCancelAtPeriodEnd(user.id, cancel, subscriptionDeps, feedback));
  } catch (error) {
    // Same error codes as api.pctweaker.app's subscription endpoints, with a readable message beside them.
    if (error instanceof SubscriptionError) { response.status(error.status).json({ error: error.code, code: error.code, message: error.message, ...(error.portalUrl ? { url: error.portalUrl } : {}) }); return; }
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
    if (!unauthorized) console.error("subscription request failed:", String((error as Error)?.message ?? error).slice(0, 200));
    response.status(unauthorized ? 401 : 502).json(unauthorized ? { error: "UNAUTHORIZED" } : { error: "billing_unavailable", code: "billing_unavailable", message: "We could not reach billing. Please try again." });
  }
}

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
  if ((request.method === "GET" && action === "subscription") || (request.method === "POST" && (action === "subscription-cancel" || action === "subscription-resume"))) {
    await subscriptionAction(action, request, response);
    return;
  }
  if (request.method === "GET" && (action === "trial-reminders" || request.headers?.["x-vercel-cron-schedule"] !== undefined)) {
    response.setHeader("Cache-Control", "no-store");
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers?.authorization !== `Bearer ${secret}`) { response.status(401).json({ error: "UNAUTHORIZED" }); return; }
    try {
      // Also makes the portal configuration exist before a customer needs it.
      await portalConfiguration();
      const reminders = await sendTrialReminders();
      // Never in the way of the reminders: a failure here is logged and the sweep reports null.
      const recovery = await sendCheckoutRecovery().catch((error: unknown) => { console.error("checkout recovery sweep failed:", String(error).slice(0, 300)); return null; });
      // Purchase consent rows end after 13 months (privacy.html).
      const consentsPurged = await purgeConsents(supabaseService).catch(() => false);
      response.status(200).json({ ...reminders, recovery, consentsPurged });
    } catch (error) {
      console.error("trial reminder sweep failed:", String(error).slice(0, 300));
      response.status(500).json({ error: "Reminder sweep failed." });
    }
    return;
  }
  if (action === "consent") { await consentAction(request, response); return; }
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
    // The Windows app 0.5.5 and older: the only client that calls from the
    // desktop app's origin without `language`, which arrived with the choice in 0.6.0.
    const origin = Array.isArray(request.headers?.origin) ? request.headers.origin[0] : request.headers?.origin;
    const oldApp = body.language === undefined && DESKTOP_ORIGINS.has(origin ?? "");
    const purchase: Purchase = { user, plan, interval, seats, price, startTrial, lang, oldApp, app: billingAppUrl(request) };
    if (consentRequired()) {
      // Our Terms box comes first (api/_consent.ts). Every client opens the
      // returned url, so the apps already installed show it without a release.
      await accountReady(user.id);
      const token = sealIntent({ ...purchase, user: user.id, email: user.email });
      response.status(200).json({ url: `${purchase.app}/checkout?t=${token}`, consent: true });
      return;
    }
    const session = await createSession(purchase);
    response.status(200).json({ url: session.url, trial: Boolean(session.trial), trialDays: session.trial?.days ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CHECKOUT_ERROR";
    if (message === "TRIAL_UNAVAILABLE") {
      response.status(409).json({ error: "The free trial is not available for this account. Subscribe now instead.", code: "trial_unavailable" });
      return;
    }
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

type Purchase = {
  user: BillingUser; plan: "personal" | "business"; interval: "monthly" | "yearly"; seats: number; price: string;
  startTrial?: boolean; lang: Language | null; oldApp: boolean; app: string;
};

/** Before the Terms page: the refusals the apps already handle (manage
 *  billing, active plan) come back to them now, not after the tick. */
async function accountReady(userId: string): Promise<void> {
  try {
    await reserveCheckout(userId);
  } catch (error) {
    // Someone else's checkout is being prepared: the Terms page will say so.
    if (error instanceof Error && error.message === "CHECKOUT_IN_PROGRESS") return;
    throw error;
  }
  await releaseCheckout(userId);
}

/**
 * The one place a Redaxa Checkout Session is created. With the consent switch
 * on it refuses to run without a consent row, and writes that row before the
 * session exists. Throws the codes both callers map to their own answers.
 */
async function createSession(p: Purchase, consent?: ConsentRow): Promise<{ id: string; url: string | null; trial: { days: number; mark: string } | null }> {
  if (consentRequired() && !consent) throw new Error("CONSENT_REQUIRED");
  // Time has passed since the plan button: someone may have used the trial meanwhile.
  if (consent && p.startTrial === true && !(await trialEligible(p.user.id, p.user.email, await accountFor(p.user.id)))) throw new Error("TRIAL_UNAVAILABLE");
  let account;
  try {
    account = await reserveCheckout(p.user.id);
  } catch (error) {
    // Changing one's mind (Subscribe now, back, Start trial) is the normal
    // path for clients that offer the choice: the checkout still open is
    // closed and replaced, so only the latest one can be paid. Clients from
    // before the choice keep the ten-minute wait they know.
    if (!(error instanceof Error && error.message === "CHECKOUT_IN_PROGRESS") || p.startTrial === undefined) throw error;
    await releaseCheckout(p.user.id);
    account = await reserveCheckout(p.user.id);
  }
  let customerId = account.stripe_customer_id;
  try {
    if (customerId) await closeEarlierCheckouts(customerId, p.user.id, account.stripe_subscription_id);
    if (!customerId) {
      const customer = await stripe.customers.create({ email: p.user.email, metadata: { redaxa_user_id: p.user.id } }, { idempotencyKey: `ps-customer-${p.user.id}` });
      customerId = customer.id;
      await saveCustomer(p.user.id, customerId);
    }
    // No choice sent: a page that could not read the offer (it shows one
    // "Go Pro" button) or the Windows app 0.5.5 and older, which never
    // offers one. An eligible new subscriber still gets the trial, always
    // under the one-per-person rule: the mark makes the webhook claim it
    // against the account, the mailbox and the card. It lasts three days,
    // like every other trial, except for that old app, whose screens and
    // terms promise seven.
    const automatic = p.startTrial === undefined && await legacyTrialEligible(p.user.id, p.user.email, account);
    const trial = p.startTrial === true || (automatic && !p.oldApp)
      ? { days: TRIAL_DAYS, mark: TRIAL_MARK }
      : automatic ? { days: LEGACY_TRIAL_DAYS, mark: LEGACY_TRIAL_MARK } : null;
    // The discount follows the plan resolved above and the server's clock.
    // A once-only coupon skips the trial's zero invoice and comes off the
    // first paid one (checked on Stripe test clocks, 10 and 14 Oct 2026).
    const promo = promoCheckout(process.env, Date.now(), p.plan, p.interval, p.seats);
    const metadata = {
      redaxa_user_id: p.user.id, plan: p.plan, interval: p.interval, seats: String(p.seats),
      ...(promo ? { promo_id: promo.id } : {}),
      ...(trial?.mark ? { trial: trial.mark } : {}),
      ...(p.lang ? { lang: p.lang } : {}),
      // What the customer ticked on /checkout: the row in checkout_consents, and the Terms it named.
      ...(consent ? { terms_version: consent.terms_version, consent_id: consent.id } : {}),
    };
    if (consent) await recordConsent(supabaseService, consent);
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      // Not passing payment_method_types: this Stripe account has Managed
      // Payments on (the newer default), which rejects an explicit list
      // and picks methods itself.
      line_items: [{ price: p.price, quantity: p.seats }],
      // The full billing address, not only the country Managed Payments asks
      // for in most of Europe: more for Stripe's fraud screening to match, so
      // fewer genuine buyers blocked. Accepted with Managed Payments.
      billing_address_collection: "required",
      // Checkout refuses promotion codes alongside a discount.
      ...(promo
        ? { discounts: [{ coupon: promo.coupon }], ...(promo.expiresAt ? { expires_at: promo.expiresAt } : {}) }
        : { allow_promotion_codes: p.interval === "monthly" }),
      // A card or another recurring method before the trial starts; with
      // none left at the end, the subscription cancels itself unpaid.
      ...(trial?.mark ? { payment_method_collection: "always" as const } : {}),
      subscription_data: {
        trial_period_days: trial?.days,
        ...(trial?.mark ? { trial_settings: { end_behavior: { missing_payment_method: "cancel" as const } } } : {}),
        metadata
      },
      metadata,
      // The page reads these to confirm the purchase in the checkout's language.
      success_url: `${p.app}/?checkout=success${p.lang ? `&lang=${p.lang}` : ""}`,
      cancel_url: `${p.app}/?checkout=cancelled${p.lang ? `&lang=${p.lang}` : ""}`
    }, { idempotencyKey: `ps-checkout-${p.user.id}-${Date.now()}` });
    if (consent) await attachSession(supabaseService, consent.id, session.id);
    return { id: session.id, url: session.url, trial };
  } catch (error) {
    await releaseCheckout(p.user.id);
    throw error;
  }
}

const first = (value: string | string[] | undefined): string | undefined => Array.isArray(value) ? value[0] : value;

/** A form post arrives parsed by Vercel; a raw string or buffer is parsed here. */
function formOf(body: unknown): Record<string, unknown> {
  if (typeof body === "string" || body instanceof Uint8Array) return Object.fromEntries(new URLSearchParams(String(body)));
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

/** GET and POST /checkout (vercel.json): the Terms box, then Stripe. */
async function consentAction(request: RequestLike, response: ResponseLike): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  const page = (status: number, input: PageInput): void => response.status(status).end(consentPage(input));
  if (request.method === "GET") {
    const token = first(request.query?.t);
    const intent = openIntent(token);
    page(intent ? 200 : 410, { lang: intent?.lang ?? null, token, intent, trialDays: TRIAL_DAYS });
    return;
  }
  if (request.method !== "POST") { response.setHeader("Allow", "GET, POST"); response.status(405).end(); return; }
  const form = formOf(request.body);
  const token = typeof form.t === "string" ? form.t : undefined;
  const intent = openIntent(token);
  if (!intent) { page(410, { lang: null }); return; }
  const show = (status: number, error: PageError): void => page(status, { lang: intent.lang, token, intent, trialDays: TRIAL_DAYS, error });
  // Our own pages only: the sealed link already stops forged requests, this stops a foreign page relaying one.
  const origin = first(request.headers?.origin);
  if (origin && origin !== billingAppUrl(request) && origin !== appUrl()) { show(403, "generic"); return; }
  if (form.agree !== "yes") { show(422, "consent"); return; }
  if (form.terms !== TERMS_VERSION) { show(409, "terms"); return; }
  if (rateLimited(`checkout:user:${intent.user}`, 10, 15 * 60_000) || rateLimited(`checkout:ip:${clientIp(request.headers)}`, 30, 15 * 60_000)) { show(429, "too_many"); return; }
  const price = priceFor(intent.plan, intent.interval);
  if (!price) { show(500, "generic"); return; }
  try {
    const session = await createSession({ ...intent, user: { id: intent.user, email: intent.email }, price }, {
      id: randomUUID(), user_id: intent.user, plan: intent.plan, billing_interval: intent.interval, seats: intent.seats,
      terms_version: TERMS_VERSION, ip: clientAddress(request.headers), user_agent_family: userAgentFamily(first(request.headers?.["user-agent"])),
    });
    if (!session.url) throw new Error("CHECKOUT_ERROR");
    response.setHeader("Location", session.url);
    response.status(303).end();
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const mapped: PageError = code === "TRIAL_UNAVAILABLE" ? "trial_unavailable" : code === "CHECKOUT_COMPLETING" ? "payment_processing"
      : code === "BILLING_ACTION_REQUIRED" ? "manage_billing" : code === "ACTIVE_SUBSCRIPTION" ? "active" : code === "CHECKOUT_IN_PROGRESS" ? "busy" : "generic";
    if (mapped === "generic") console.error("consent checkout error:", error);
    show(mapped === "generic" ? 500 : mapped === "busy" ? 429 : 409, mapped);
  }
}
