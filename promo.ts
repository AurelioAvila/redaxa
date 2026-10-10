import { isTauri } from "./desktop.js";

/** A time-limited offer as published by GET /api/billing?action=promo. Display
 *  only: the server decides the discount at checkout, from its own clock. */
export type PromoOffer = {
  plan: string;
  interval: string;
  /** Euro cents per user, excluding VAT, like the Stripe Prices. */
  regular: number;
  /** The lowest price of the previous 30 days: the only one that may be struck through. */
  reference: number;
  price: number;
  perSeat: boolean;
};

export type Promo = { serverTime: string; id: string; status: "scheduled" | "active"; startsAt: string; endsAt: string; offers: PromoOffer[] };

const cents = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const time = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/** Null for "no offer" and for anything malformed: a broken payload must never
 *  draw a struck price. An offer that is not a real reduction is dropped. */
export function parsePromo(value: unknown): Promo | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || (v.status !== "active" && v.status !== "scheduled")) return null;
  if (typeof v.id !== "string" || !time(v.serverTime) || !time(v.startsAt) || !time(v.endsAt) || !Array.isArray(v.offers)) return null;
  const offers = (v.offers as Record<string, unknown>[]).filter((o) =>
    o && typeof o.plan === "string" && typeof o.interval === "string" && o.currency === "eur" &&
    cents(o.regular) && cents(o.reference) && cents(o.price) &&
    (o.price as number) < (o.reference as number) && (o.reference as number) <= (o.regular as number) &&
    typeof o.perSeat === "boolean" && o.firstPeriodOnly === true,
  ).map((o) => ({ plan: o.plan, interval: o.interval, regular: o.regular, reference: o.reference, price: o.price, perSeat: o.perSeat }) as PromoOffer);
  return { serverTime: v.serverTime, id: v.id, status: v.status, startsAt: v.startsAt, endsAt: v.endsAt, offers: v.status === "active" ? offers : [] };
}

/** Rounded down, so the badge never claims more than the real discount. */
export function promoPercent(offer: Pick<PromoOffer, "reference" | "price">): number {
  return Math.floor(((offer.reference - offer.price) * 100) / offer.reference);
}

/** Milliseconds until `iso` on the server's clock plus the time elapsed since
 *  the response arrived, so a wrong device clock cannot extend the offer. */
export function msUntil(promo: Pick<Promo, "serverTime">, iso: string, elapsedMs: number): number {
  return Date.parse(iso) - Date.parse(promo.serverTime) - Math.max(0, elapsedMs);
}

/** Days, hours, minutes and seconds left; zero at and after the deadline. */
export function promoClock(ms: number): [string, string, string, string] {
  const s = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  return [Math.floor(s / 86_400), Math.floor((s % 86_400) / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((value) => String(value).padStart(2, "0")) as [string, string, string, string];
}

/** "50%" in English and Italian, "50 %" where the language spaces it. */
export function percentLabel(value: number, lang = "en"): string {
  return new Intl.NumberFormat(lang === "en" ? "en-IE" : lang, { style: "percent", maximumFractionDigits: 0 }).format(value / 100);
}

export function euro(centsValue: number, lang = "en"): string {
  return new Intl.NumberFormat(lang === "en" ? "en-IE" : lang, { style: "currency", currency: "EUR" }).format(centsValue / 100);
}

export type PromoView = { promo: Promo | null; remaining: number; offer(plan: string, interval: string): PromoOffer | null };

/** Reads the offer and calls `render` once a second while one runs, and once
 *  more when it ends or the server withdraws it. Re-read every five minutes
 *  and whenever the window regains focus; any failure means regular prices. */
export function watchPromo(render: (view: PromoView) => void): void {
  const base = isTauri() ? "https://promptshield-beta.vercel.app" : "";
  const clock = () => ({ perf: performance.now(), wall: Date.now() });
  let received: { promo: Promo; at: ReturnType<typeof clock> } | null = null;
  let shown = false;
  const tick = (): void => {
    const promo = received?.promo ?? null;
    const now = clock();
    // Whichever clock advanced more: a paused (sleep) or wrong clock can only shorten the offer.
    const elapsed = received ? Math.max(now.perf - received.at.perf, now.wall - received.at.wall) : 0;
    const active = Boolean(promo && promo.status === "active" && msUntil(promo, promo.startsAt, elapsed) <= 0 && msUntil(promo, promo.endsAt, elapsed) > 0);
    if (!active && !shown) return;
    shown = active;
    render({
      promo: active ? promo : null,
      remaining: active && promo ? msUntil(promo, promo.endsAt, elapsed) : 0,
      offer: (plan, interval) => (active && promo?.offers.find((o) => o.plan === plan && o.interval === interval)) || null,
    });
  };
  const read = async (): Promise<void> => {
    try {
      const response = await fetch(`${base}/api/billing?action=promo`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      const promo = response.ok ? parsePromo(await response.json()) : null;
      received = promo ? { promo, at: clock() } : null;
    } catch {
      received = null;
    }
    tick();
  };
  void read();
  window.setInterval(tick, 1000);
  window.setInterval(() => void read(), 5 * 60_000);
  window.addEventListener("focus", () => void read());
}

const PUMPKIN = '<svg class="rx-promo-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 7.5c-1.6-1-4.4-1.2-6.2.4C3.6 9.8 3.4 14 4.6 16.6c1.3 2.8 4.3 3.6 7.4 2.6 3.1 1 6.1.2 7.4-2.6 1.2-2.6 1-6.8-1.2-8.7-1.8-1.6-4.6-1.4-6.2-.4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 7.5c-1.3 2.4-1.3 9.3 0 11.7m0-11.7c1.3 2.4 1.3 9.3 0 11.7M12 7.5c0-1.6.6-3 2-3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

export type PromoWords = {
  title: string; lead: string; terms: string; ends: string; endsIn: string; units: [string, string, string, string];
  thenMonth: string; thenYear: string; thenUserMonth: string; thenUserYear: string;
  perMonth: string; perYear: string; perUserMonth: string; perUserYear: string;
};

/** "6 November 2026 at 23:59 CET" in the reader's own zone, named so it
 *  cannot be misread: the last minute on sale, not the exclusive deadline. */
export function promoEndLabel(promo: Pick<Promo, "endsAt">, lang = "en"): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
    .format(new Date(Date.parse(promo.endsAt) - 60_000));
}

type Variant = "Month" | "Year" | "UserMonth" | "UserYear";
const variant = (offer: PromoOffer): Variant => `${offer.perSeat ? "User" : ""}${offer.interval === "yearly" ? "Year" : "Month"}` as Variant;

/** The large countdown banner. Static strings and numbers only: nothing from
 *  the network reaches the markup except parsed cents and a parsed date. */
export function promoBanner(promo: Promo, words: PromoWords, lang = "en"): HTMLElement {
  const percent = Math.min(...promo.offers.map(promoPercent));
  const banner = document.createElement("aside");
  banner.className = "rx-promo";
  banner.setAttribute("aria-label", words.title);
  banner.innerHTML = `<div class="rx-promo-copy"><p class="rx-promo-title">${PUMPKIN}<span></span></p><p class="rx-promo-lead"></p><p class="rx-promo-ends"></p></div>`
    + `<div class="rx-promo-timer"><p class="rx-promo-ends-in"></p><div class="rx-promo-clock" role="timer" aria-live="off">${words.units.map(() => "<div><strong>00</strong><span></span></div>").join("")}</div></div>`
    + `<p class="rx-promo-terms"></p>`;
  banner.querySelector(".rx-promo-title span")!.textContent = words.title;
  banner.querySelector(".rx-promo-lead")!.textContent = words.lead.replace("{percent}", percentLabel(percent, lang));
  banner.querySelector(".rx-promo-ends")!.textContent = words.ends.replace("{date}", promoEndLabel(promo, lang));
  banner.querySelector(".rx-promo-ends-in")!.textContent = words.endsIn;
  banner.querySelector(".rx-promo-terms")!.textContent = words.terms;
  banner.querySelectorAll(".rx-promo-clock span").forEach((span, i) => { span.textContent = words.units[i]; });
  return banner;
}

export function updatePromoClock(banner: HTMLElement, remaining: number, words: PromoWords): void {
  const values = promoClock(remaining);
  banner.querySelectorAll(".rx-promo-clock strong").forEach((cell, i) => { if (cell.textContent !== values[i]) cell.textContent = values[i]; });
  banner.querySelector(".rx-promo-clock")!.setAttribute("aria-label", values.map((v, i) => `${v} ${words.units[i]}`).join(", "));
}

/** Struck reference, offer price, unit, the real percentage and what renews,
 *  as markup for a price slot. Every value is formatted here from numbers. */
export function promoPriceHtml(offer: PromoOffer, words: PromoWords, lang = "en"): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const v = variant(offer);
  const then = words[`then${v}`].replace("{price}", euro(offer.regular, lang));
  return `<s class="rx-was">${euro(offer.reference, lang)}</s> ${euro(offer.price, lang)} <small>${escape(words[`per${v}`])}</small>`
    + `<span class="rx-off">−${percentLabel(promoPercent(offer), lang)}</span><small class="price-equiv">${escape(then)}</small>`;
}

export const PROMO_WORDS_EN: PromoWords = {
  title: "Halloween offer",
  lead: "{percent} off your first month or year of Pro and Business.",
  ends: "Ends {date}.",
  endsIn: "Ends in",
  units: ["days", "hours", "min", "sec"],
  terms: "Struck-through prices are the lowest we charged in the 30 days before the offer began. The discount applies to the first paid month or year only; renewals are at the regular price. Eligible new subscribers still start with the 7-day trial. Prices exclude VAT, which is added at checkout where applicable.",
  thenMonth: "First month, then {price} a month",
  thenYear: "First year, then {price} a year",
  thenUserMonth: "First month, then {price} per user a month",
  thenUserYear: "First year, then {price} per user a year",
  perMonth: "/ month", perYear: "/ year", perUserMonth: "/ user / month", perUserYear: "/ user / year",
};
