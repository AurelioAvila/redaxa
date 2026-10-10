/**
 * Creates (or checks) the Stripe coupons behind api/_promo.ts, through the
 * Stripe CLI, so no secret key is ever handled here:
 *
 *   npm run build
 *   node scripts/halloween-coupons.mjs                     # test mode, check only
 *   node scripts/halloween-coupons.mjs --apply             # test mode, create missing coupons
 *   node scripts/halloween-coupons.mjs --live --verify-session
 *
 * The STRIPE_PRICE_* variables name the Prices of the chosen mode (price IDs
 * are not secrets). Coupon IDs are fixed, so a rerun creates nothing twice.
 * --verify-session opens one unpaid Checkout per coupon with the discount,
 * checks Stripe's totals and expires it at once: nothing is charged.
 * Only after every line reads "ok" may PROMO_ID=halloween50-2026 be set on
 * the deployment; unset it (or set PROMO_DISABLED=1) to stop the offer.
 */
import { spawnSync } from "node:child_process";
import { MAX_SEATS, PROMO, PROMO_GRACE_SECONDS, couponId } from "../dist/api/_promo.js";

const live = process.argv.includes("--live");
const apply = process.argv.includes("--apply");
const verifySession = process.argv.includes("--verify-session");

function stripe(...args) {
  const run = spawnSync("stripe", [...args, ...(live ? ["--live"] : [])], { encoding: "utf8" });
  const out = run.stdout ?? "";
  const start = out.indexOf("{");
  if (start < 0) throw new Error(`stripe ${args[0]} ${args[1]} returned nothing (${(run.stderr ?? "").trim().slice(0, 200)})`);
  return JSON.parse(out.slice(start, out.lastIndexOf("}") + 1));
}

// The server stops discounting at endsAt; a checkout opened just before stays
// payable for the grace period, so the coupon must outlive it slightly.
const redeemBy = Math.floor(Date.parse(PROMO.endsAt) / 1000) + PROMO_GRACE_SECONDS + 300;
let failed = false;
const fail = (message) => { failed = true; console.error(`FAIL ${message}`); };

console.log(`${live ? "LIVE" : "TEST"} mode, ${apply ? "apply" : "check only"}`);
for (const offer of PROMO.offers) {
  const priceId = process.env[offer.priceEnv];
  if (!priceId) { fail(`${offer.priceEnv} is not set`); continue; }
  const price = stripe("prices", "retrieve", priceId);
  if (price.error || price.unit_amount !== offer.regular || price.currency !== "eur" || price.livemode !== live || !price.active) {
    fail(`${offer.priceEnv} is ${price.unit_amount} ${price.currency}, expected ${offer.regular} eur`);
    continue;
  }
  for (let seats = 1; seats <= (offer.plan === "business" ? MAX_SEATS : 1); seats++) {
    const id = couponId(offer, seats);
    const wanted = { amount_off: seats * (offer.regular - offer.price), currency: "eur", duration: "once", redeem_by: redeemBy };
    let coupon = stripe("coupons", "retrieve", id, "-d", "expand[]=applies_to");
    if (coupon.error?.code === "resource_missing") coupon = null;
    else if (coupon.error) throw new Error(`${id}: ${coupon.error.message}`);
    if (!coupon && apply) {
      coupon = stripe("coupons", "create", "-d", `id=${id}`,
        ...Object.entries(wanted).flatMap(([field, value]) => ["-d", `${field}=${value}`]),
        "-d", `applies_to[products][0]=${price.product}`, "-d", "name=Halloween offer",
        "-d", `metadata[promo]=${PROMO.id}`, "-d", "metadata[product]=redaxa", "-d", `metadata[plan]=${offer.plan}`,
        "-d", `metadata[interval]=${offer.interval}`, "-d", `metadata[seats]=${seats}`, "-d", "expand[]=applies_to");
      if (coupon.error) throw new Error(`${id}: ${coupon.error.message}`);
      console.log(`created ${id}`);
    }
    if (!coupon) { fail(`${id} does not exist (run with --apply)`); continue; }
    const products = coupon.applies_to?.products ?? [];
    if (Object.entries(wanted).some(([field, value]) => coupon[field] !== value) || !coupon.valid || coupon.livemode !== live ||
        products.length !== 1 || products[0] !== price.product) {
      fail(`${id} does not match api/_promo.ts; delete it in Stripe only while PROMO_ID is unset`);
      continue;
    }
    console.log(`ok   ${id}  (${seats} x ${offer.regular} -> ${seats} x ${offer.price} cents, redeem by ${new Date(redeemBy * 1000).toISOString()})`);

    if (verifySession) {
      const session = stripe("checkout", "sessions", "create", "-d", "mode=subscription",
        "-d", `line_items[0][price]=${priceId}`, "-d", `line_items[0][quantity]=${seats}`, "-d", `discounts[0][coupon]=${id}`,
        "-d", "success_url=https://redaxa.getcertsprint.com/?checkout=success", "-d", "cancel_url=https://redaxa.getcertsprint.com/?checkout=cancelled",
        "-d", `expires_at=${Math.floor(Date.now() / 1000) + PROMO_GRACE_SECONDS + 60}`, "-d", `metadata[promo_verification]=${PROMO.id}`);
      if (session.error) { fail(`${id} checkout: ${session.error.message}`); continue; }
      stripe("checkout", "sessions", "expire", session.id);
      const discount = session.total_details?.amount_discount;
      if (session.amount_subtotal !== seats * offer.regular || discount !== seats * (offer.regular - offer.price)) {
        fail(`${id} checkout quoted ${session.amount_subtotal} - ${discount}`);
      } else {
        console.log(`     checkout ${session.id.slice(0, 16)}… quoted ${session.amount_subtotal} - ${discount} = ${seats * offer.price} before tax, expired`);
      }
    }
  }
}
if (failed) process.exitCode = 1;
