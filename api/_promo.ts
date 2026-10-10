/**
 * Halloween 2026: half price on the first month or year of every paid plan,
 * from release until 23:59:59 on 6 November (Europe/Rome). Owner decision of
 * 10 October 2026, the same offer PC Tweaker runs.
 *
 * `reference` is the only price that may be struck through. EU law (Omnibus
 * Directive, art. 17-bis Codice del consumo) allows the LOWEST price charged
 * to the public in the 30 days before the reduction starts, and the
 * percentage shown is measured against it. Reconstructed from the live
 * Stripe Prices and every Redaxa Checkout Session since August (none was
 * paid, none carried a discount, the promotion codes on file are inactive):
 *   - Pro monthly       €7.99 since 11 Aug.
 *   - Pro yearly        €79.99 until 27 Sep 08:01 UTC, €79.90 since.
 *   - Business monthly  €14.99 per user since 11 Aug.
 *   - Business yearly   €149.99 until 27 Sep 08:00 UTC, €149.90 since.
 * So the references equal today's prices and every badge reads 50%.
 *
 * Every amount is in euro cents per user, excluding VAT, like the Stripe
 * Prices. Business is sold in 1–3 seats, and an amount_off coupon comes off
 * the whole subtotal once, so each seat count has its own coupon taking
 * `seats × (regular − price)`: the total is always exactly seats × price.
 * Coupons cannot be edited: another amount or end date needs new IDs, and no
 * STRIPE_PRICE_* may change during the window. scripts/halloween-coupons.mjs
 * creates and checks them; this file never talks to Stripe.
 *
 * Next promotions: until about 6 December the lowest prices of the previous
 * 30 days are these promo prices, so a Black Friday reduction must strike
 * them, not the list prices.
 */
export const PROMO = {
  id: "halloween50-2026",
  // The earliest go-live; nothing is discounted until PROMO_ID is set.
  startsAt: "2026-10-10T00:00:00.000Z",
  // Exclusive: the last second on sale is 23:59:59 on 6 November, Rome (CET).
  endsAt: "2026-11-06T23:00:00.000Z",
  offers: [
    { plan: "personal", interval: "monthly", priceEnv: "STRIPE_PRICE_PERSONAL_MONTHLY", regular: 799, reference: 799, price: 399 },
    { plan: "personal", interval: "yearly", priceEnv: "STRIPE_PRICE_PERSONAL_YEARLY", regular: 7990, reference: 7990, price: 3995 },
    { plan: "business", interval: "monthly", priceEnv: "STRIPE_PRICE_BUSINESS_MONTHLY", regular: 1499, reference: 1499, price: 749 },
    { plan: "business", interval: "yearly", priceEnv: "STRIPE_PRICE_BUSINESS_YEARLY", regular: 14990, reference: 14990, price: 7495 },
  ],
} as const;

/** Stripe's shortest Checkout lifetime: a checkout opened in the last minutes
 *  stays payable this long, never longer. */
export const PROMO_GRACE_SECONDS = 30 * 60;
export const MAX_SEATS = 3;

type Offer = (typeof PROMO.offers)[number];

export type PublicPromo = {
  serverTime: string;
  id: string | null;
  status: "disabled" | "scheduled" | "active";
  startsAt: string | null;
  endsAt: string | null;
  offers: {
    plan: string;
    interval: string;
    currency: "eur";
    regular: number;
    reference: number;
    price: number;
    percentOff: number;
    perSeat: boolean;
    /** Only the first paid month or year is discounted; renewals are regular. */
    firstPeriodOnly: true;
  }[];
};

/** The coupon for one checkout: Business has one per seat count. */
export function couponId(offer: Pick<Offer, "plan" | "interval">, seats: number): string {
  return offer.plan === "business" ? `${PROMO.id}-redaxa-business-${offer.interval}-${seats}` : `${PROMO.id}-redaxa-${offer.plan}-${offer.interval}`;
}

/** Rounded down, so the badge never claims more than the real discount. */
export function percentOff(reference: number, price: number): number {
  return Math.floor(((reference - price) * 100) / reference);
}

function enabled(environment: NodeJS.ProcessEnv): boolean {
  return environment.PROMO_ID === PROMO.id && environment.PROMO_DISABLED !== "1";
}

/** The promotion as of `nowMs`. Off after the end, before PROMO_ID is set,
 *  with PROMO_DISABLED=1, and publishes no prices before the start. */
export function promoState(environment: NodeJS.ProcessEnv = process.env, nowMs: number = Date.now()): PublicPromo {
  const base: PublicPromo = { serverTime: new Date(nowMs).toISOString(), id: null, status: "disabled", startsAt: null, endsAt: null, offers: [] };
  if (!enabled(environment) || nowMs >= Date.parse(PROMO.endsAt)) return base;
  const window = { id: PROMO.id, startsAt: PROMO.startsAt, endsAt: PROMO.endsAt };
  if (nowMs < Date.parse(PROMO.startsAt)) return { ...base, ...window, status: "scheduled" };
  return {
    ...base,
    ...window,
    status: "active",
    // A price that is not below its lawful reference is not a reduction and is never shown as one.
    offers: PROMO.offers.filter((offer) => offer.price < offer.reference && offer.reference <= offer.regular).map(({ plan, interval, regular, reference, price }) => ({
      plan, interval, currency: "eur" as const, regular, reference, price,
      percentOff: percentOff(reference, price),
      perSeat: plan === "business",
      firstPeriodOnly: true as const,
    })),
  };
}

/** The discount for a checkout about to be created, decided from the server's
 *  clock and the plan the server resolved, never from the client. */
export function promoCheckout(environment: NodeJS.ProcessEnv, nowMs: number, plan: string, interval: string, seats: number) {
  const state = promoState(environment, nowMs);
  if (state.status !== "active") return null;
  const offer = PROMO.offers.find((candidate) => candidate.plan === plan && candidate.interval === interval);
  if (!offer || !state.offers.some((o) => o.plan === plan && o.interval === interval)) return null;
  if (!Number.isInteger(seats) || seats < 1 || seats > (plan === "business" ? MAX_SEATS : 1)) return null;
  const nowSeconds = Math.floor(nowMs / 1000);
  const endSeconds = Math.floor(Date.parse(PROMO.endsAt) / 1000);
  return {
    coupon: couponId(offer, seats),
    id: PROMO.id,
    // Checkout allows 30 minutes to 24 hours.
    expiresAt: Math.min(nowSeconds + 24 * 60 * 60, Math.max(endSeconds, nowSeconds + PROMO_GRACE_SECONDS)),
  };
}
