import { accountFor, stripe, supabaseService, supabaseUserById } from "./_billing.js";
import { isLive, language } from "./_trial.js";
import { sendTrialMail } from "./_trial-email.js";

const HOUR = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Your payment didn't go through" (owner decision, 1 November 2026): one
 * email when a signed-in customer's checkout payment fails or Stripe blocks
 * it, with the way back to the same plan.
 *
 * The webhook endpoint is not subscribed to payment or setup failures and its
 * settings stay as they are, so the cron sweep reads them from the Events
 * API instead. A failure counts only when it is 30 minutes to 24 hours old
 * (time to try again on Stripe's page first; the sweep runs every six hours),
 * belongs to a Redaxa subscription checkout that never completed, and the
 * account holds no live subscription since. Renewal failures have their own
 * email (payment_failed) and are skipped: a renewal's payment is not
 * "Subscription creation", and a renewal has no unfinished checkout. At most
 * one email per account and plan every 24 hours, claimed in the database
 * before sending; a send that fails is not retried, because for this email
 * missing one beats sending two.
 */
export async function sendCheckoutRecovery(now = Date.now()): Promise<{ failed: number; sent: number }> {
  const at = Math.floor(now / 1000);
  let failed = 0;
  let sent = 0;
  const seen = new Set<string>();
  // ponytail: a full scan of a day's failures for the whole Stripe account;
  // fine at today's volume, filter by customer first if it ever is not.
  for await (const event of stripe.events.list({ types: ["payment_intent.payment_failed", "setup_intent.setup_failed"], created: { gte: at - 24 * HOUR, lte: at - 30 * 60 }, limit: 100 })) {
    const attempt = event.data.object as { id: string; customer?: string | { id: string } | null; description?: string | null; created: number };
    const customer = typeof attempt.customer === "string" ? attempt.customer : attempt.customer?.id;
    if (!customer || seen.has(attempt.id)) continue;
    if (event.type === "payment_intent.payment_failed" && attempt.description !== "Subscription creation") continue;
    seen.add(attempt.id);
    try {
      // The checkout this attempt was made in: the latest Redaxa one opened
      // for the customer before it (a checkout stays payable for 24 hours).
      const sessions = await stripe.checkout.sessions.list({ customer, created: { gte: attempt.created - 24 * HOUR, lte: attempt.created }, limit: 10 });
      const session = sessions.data.find((candidate) => candidate.mode === "subscription" && candidate.metadata?.redaxa_user_id);
      const userId = session?.metadata?.redaxa_user_id ?? "";
      const plan = session?.metadata?.plan === "business" ? "business" : session?.metadata?.plan === "personal" ? "personal" : null;
      if (!session || session.status === "complete" || !UUID.test(userId) || !plan) continue;
      failed += 1;
      if (isLive((await accountFor(userId))?.subscription_status)) continue;
      const to = (await supabaseUserById(userId))?.email;
      if (!to || !(await claim(userId, plan, attempt.id))) continue;
      const ok = await sendTrialMail("checkout_failed", {
        to,
        lang: language(session.metadata?.lang),
        plan,
        interval: session.metadata?.interval ?? null,
        seats: Number(session.metadata?.seats) || 1,
        days: 0,
      }, `redaxa-checkout-failed/${attempt.id}`);
      if (ok) sent += 1;
    } catch (error) {
      console.error("checkout recovery failed for", attempt.id, String(error).slice(0, 200));
    }
  }
  return { failed, sent };
}

/** False when this account and plan already had the email in the last 24 hours,
 *  or the claim could not be recorded (no table yet): never a second email. */
async function claim(userId: string, plan: string, paymentId: string): Promise<boolean> {
  const response = await supabaseService("/rest/v1/rpc/claim_redaxa_checkout_recovery", {
    method: "POST", body: JSON.stringify({ p_user_id: userId, p_plan: plan, p_payment_id: paymentId }),
  });
  if (!response.ok) { console.error("checkout recovery claim failed:", response.status); return false; }
  return (await response.json()) === true;
}
