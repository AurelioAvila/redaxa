/**
 * Self-service account deletion: the steps, in the order that keeps a failure
 * harmless. Nothing is deleted before Frame Witness has answered and every
 * subscription has ended, so a retry after any error finishes the job.
 *
 * The sign-in lives in a Supabase project Redaxa shares with Frame Witness
 * (supabase/email-templates/README.md), and Frame Witness keys the licences
 * it sells by the same user id. Deleting the sign-in of someone who bought
 * Frame Witness would lock them out of it, so in that case only the Redaxa
 * side goes and the sign-in stays.
 */

import { accountFor, organizationForOwner, stripe, supabaseService, supabaseUrl, supabaseUserById, type BillingUser } from "./_billing.js";
import { sendAccountDeletedEmail, sendMemberLeftEmail } from "./_email.js";
import { isLive } from "./_trial.js";

/** The cancellation comment of subscriptions an account deletion ends. The
 *  webhook sends no "trial ended" email for them: the deletion sends one
 *  message, and the account is gone. */
export const ACCOUNT_DELETED = "redaxa_account_deleted";

const FRAME_WITNESS_LICENCES = "https://frame-witness-forensics.pages.dev/api/commerce/licenses";

/** Whether Frame Witness holds a licence or a trial for this sign-in, asked
 *  with the customer's own session. Throws when Frame Witness cannot say:
 *  nothing is deleted on a guess. */
export async function frameWitnessUses(accessToken: string): Promise<boolean> {
  const response = await fetch(FRAME_WITNESS_LICENCES, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) })
    .catch(() => null);
  // Frame Witness refuses an address it never confirmed, so it holds nothing for it.
  if (response?.status === 401) return false;
  if (!response?.ok) throw new Error("FRAME_WITNESS_UNAVAILABLE");
  const body = await response.json().catch(() => null) as { orders?: unknown; trial?: unknown } | null;
  if (!body || !Array.isArray(body.orders)) throw new Error("FRAME_WITNESS_UNAVAILABLE");
  return body.orders.length > 0 || Boolean(body.trial);
}

/**
 * Ends every live subscription of the account at once. No proration and no
 * final invoice: nothing is refunded on a digital product, and nothing more is
 * charged. Checkouts still open are closed, so none can be paid afterwards.
 * Returns how many subscriptions it ended; a retry finds none left.
 */
export async function endBilling(userId: string): Promise<number> {
  try {
    const account = await accountFor(userId);
    const customer = account?.stripe_customer_id;
    if (!customer) return 0;
    let ended = 0;
    // ponytail: one page of 100; a Redaxa customer holds one subscription, rarely two.
    for (const subscription of (await stripe.subscriptions.list({ customer, status: "all", limit: 100 })).data) {
      const ours = subscription.metadata?.redaxa_user_id === userId || subscription.id === account.stripe_subscription_id;
      if (!ours || !isLive(subscription.status)) continue;
      await stripe.subscriptions.cancel(subscription.id, { prorate: false, invoice_now: false, cancellation_details: { comment: ACCOUNT_DELETED } });
      ended += 1;
    }
    for (const session of (await stripe.checkout.sessions.list({ customer, status: "open", limit: 100 })).data) {
      if (session.metadata?.redaxa_user_id === userId) await stripe.checkout.sessions.expire(session.id);
    }
    return ended;
  } catch (error) {
    console.error("account deletion: billing step failed", String((error as Error)?.message ?? error).slice(0, 200));
    throw new Error("BILLING_ERROR");
  }
}

export type DeletedAccount = { subscriptionsEnded: number; signInKept: boolean; emailSent: boolean };

/**
 * Deletes the caller's Redaxa account. `user` and `accessToken` come from
 * requireSession: the token is the customer's own, used to ask Frame Witness
 * and, when the sign-in stays, to sign out every device.
 */
export async function deleteAccount(user: BillingUser, accessToken: string): Promise<DeletedAccount> {
  const signInKept = await frameWitnessUses(accessToken);
  const subscriptionsEnded = await endBilling(user.id);

  // Every Redaxa row, in one transaction (supabase/migrations/20261031_account_deletion.sql).
  const rows = await supabaseService("/rest/v1/rpc/delete_redaxa_account", { method: "POST", body: JSON.stringify({ p_user_id: user.id }) });
  if (!rows.ok) {
    console.error("account deletion: delete_redaxa_account failed", rows.status);
    throw new Error("ACCOUNT_STORAGE_ERROR");
  }
  const workspaceOwner = await rows.json().catch(() => null) as unknown;

  if (signInKept) {
    // Every session ends, Frame Witness's included: the customer signs in
    // again there. The welcome mark goes, so a new Redaxa account starts fresh.
    await fetch(`${supabaseUrl()}/auth/v1/logout?scope=global`, {
      method: "POST", headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "", Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
    await supabaseService(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "PUT", body: JSON.stringify({ user_metadata: { welcomed_at: null } }) }).catch(() => undefined);
  } else {
    // Sessions, refresh tokens and identities go with the user.
    const auth = await supabaseService(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
    if (!auth.ok && auth.status !== 404) {
      console.error("account deletion: sign-in delete failed", auth.status);
      throw new Error("ACCOUNT_STORAGE_ERROR");
    }
  }

  // A member's seat is free again: the owner hears it as they would for a leave.
  if (typeof workspaceOwner === "string") {
    try {
      const [owner, org] = await Promise.all([supabaseUserById(workspaceOwner), organizationForOwner(workspaceOwner)]);
      if (owner?.email) await sendMemberLeftEmail(owner.email, user.email, org?.name || "your workspace");
    } catch (error) { console.error("member-left notice not sent", error instanceof Error ? error.message : "unknown"); }
  }

  const when = `${new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} UTC`;
  const emailSent = await sendAccountDeletedEmail({ email: user.email, when, cancelled: subscriptionsEnded, signInKept }).catch(() => false);
  // The record of the deletion, naming nobody. A paying customer's
  // cancellation also stays in Stripe, under the comment above.
  console.log(JSON.stringify({ event: "account_deleted", subscriptionsEnded, signInKept, emailSent }));
  return { subscriptionsEnded, signInKept, emailSent };
}
