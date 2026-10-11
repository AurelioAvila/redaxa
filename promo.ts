import { isTauri, usesDesktopPreviewTransport } from "./desktop.js";
import { HALLOWEEN_DECOR_LEFT, HALLOWEEN_DECOR_RIGHT, HALLOWEEN_MARK_EMBER, HALLOWEEN_MARK_INK } from "./halloween-decor.js";

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
  // "Active" with nothing valid to sell is not an offer: never a banner without prices.
  if (v.status === "active" && offers.length === 0) return null;
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

/** €3.99, €39: whole euros stay short, anything else shows cents. */
export function euro(centsValue: number, lang = "en"): string {
  return new Intl.NumberFormat(lang === "en" ? "en-IE" : lang, { style: "currency", currency: "EUR", minimumFractionDigits: centsValue % 100 ? 2 : 0 }).format(centsValue / 100);
}

export type PromoView = { promo: Promo | null; remaining: number; offer(plan: string, interval: string): PromoOffer | null };

/** Until this instant the pricing area keeps room for the banner while the
 *  server answers, so the plans do not jump when it appears. It only reserves
 *  space: nothing about the offer is shown without the server. */
export const PROMO_LAYOUT_UNTIL = Date.parse("2026-11-06T23:00:00.000Z");

/** Reads the offer and calls `render` on the first answer, once a second
 *  while an offer runs, and once more when it ends or the server withdraws
 *  it. Re-read every five minutes and whenever the window regains focus; any
 *  failure means regular prices. */
export function watchPromo(render: (view: PromoView) => void): void {
  // The packaged app reads the live offer from the API (CORS allows its
  // origin). A development build runs on 127.0.0.1, which the API rejects, so
  // it reads the same live, read-only answer through the guarded local relay.
  const preview = usesDesktopPreviewTransport(isTauri(), location.origin);
  const url = preview ? "/api/desktop-preview/api/billing?action=promo" : `${isTauri() ? "https://promptshield-beta.vercel.app" : ""}/api/billing?action=promo`;
  const clock = () => ({ perf: performance.now(), wall: Date.now() });
  let received: { promo: Promo; at: ReturnType<typeof clock> } | null = null;
  let answered = false;
  // null until the first answer has been rendered, then whether an offer is showing.
  let shown: boolean | null = null;
  const tick = (): void => {
    if (!answered) return;
    const promo = received?.promo ?? null;
    const now = clock();
    // Whichever clock advanced more: a paused (sleep) or wrong clock can only shorten the offer.
    const elapsed = received ? Math.max(now.perf - received.at.perf, now.wall - received.at.wall) : 0;
    const active = Boolean(promo && promo.status === "active" && msUntil(promo, promo.startsAt, elapsed) <= 0 && msUntil(promo, promo.endsAt, elapsed) > 0);
    if (!active && shown === false) return;
    shown = active;
    render({
      promo: active ? promo : null,
      remaining: active && promo ? msUntil(promo, promo.endsAt, elapsed) : 0,
      offer: (plan, interval) => (active && promo?.offers.find((o) => o.plan === plan && o.interval === interval)) || null,
    });
  };
  const read = async (): Promise<void> => {
    try {
      const response = await fetch(url, { cache: "no-store", headers: preview ? { "x-redaxa-desktop": "1" } : undefined, signal: AbortSignal.timeout(8000) });
      const promo = response.ok ? parsePromo(await response.json()) : null;
      received = promo ? { promo, at: clock() } : null;
    } catch {
      received = null;
    }
    answered = true;
    tick();
  };
  void read();
  window.setInterval(tick, 1000);
  window.setInterval(() => void read(), 5 * 60_000);
  window.addEventListener("focus", () => void read());
}

export type PromoWords = {
  kicker: string; lead: string; ends: string; fine: string; endsIn: string; units: [string, string, string, string];
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

/** The Halloween banner shared with PC Tweaker (carved pumpkins, countdown
 *  cells), as plain DOM. Starts reserved: invisible, holding its exact place
 *  until the server answers. Only static strings and numbers reach it. */
function bannerElement(): HTMLElement {
  const banner = document.createElement("section");
  banner.className = "hw-offer hw-offer-reserved";
  banner.style.visibility = "hidden";
  banner.setAttribute("aria-hidden", "true");
  banner.innerHTML = `<div class="hw-offer-inner">`
    + `<span class="hw-offer-decor hw-offer-decor-left" aria-hidden="true">${HALLOWEEN_DECOR_LEFT}</span>`
    + `<span class="hw-offer-decor hw-offer-decor-right" aria-hidden="true">${HALLOWEEN_DECOR_RIGHT}</span>`
    + `<div class="hw-offer-copy"><h3 class="hw-offer-kicker" id="redaxa-promo-title"></h3><p class="hw-offer-heading"></p><p class="hw-offer-fine"></p></div>`
    + `<div class="hw-offer-timer"><span aria-hidden="true"></span><div class="hw-offer-cells" role="timer" aria-live="off">`
    + [0, 1, 2, 3].map(() => `<div class="hw-offer-cell" aria-hidden="true"><strong>00</strong><small></small></div>`).join("")
    + `</div></div></div>`;
  return banner;
}

function fillBanner(banner: HTMLElement, promo: Promo | null, words: PromoWords, lang: string): void {
  const percent = promo ? Math.min(...promo.offers.map(promoPercent)) : 50;
  const end = promoEndLabel(promo ?? { endsAt: new Date(PROMO_LAYOUT_UNTIL).toISOString() }, lang);
  banner.querySelector(".hw-offer-kicker")!.textContent = words.kicker;
  banner.querySelector(".hw-offer-heading")!.textContent = `${words.lead.replace("{percent}", percentLabel(percent, lang))} ${words.ends.replace("{date}", end)}`;
  banner.querySelector(".hw-offer-fine")!.textContent = words.fine;
  banner.querySelector(".hw-offer-timer > span")!.textContent = words.endsIn;
  banner.querySelectorAll(".hw-offer-cell small").forEach((unit, i) => { unit.textContent = words.units[i]; });
}

function clockBanner(banner: HTMLElement, remaining: number, words: PromoWords): void {
  const values = promoClock(remaining);
  banner.querySelectorAll(".hw-offer-cell strong").forEach((cell, i) => { if (cell.textContent !== values[i]) cell.textContent = values[i]; });
  banner.querySelector(".hw-offer-cells")!.setAttribute("aria-label", `${words.endsIn} ${values.slice(0, 3).map((v, i) => `${Number(v)} ${words.units[i]}`).join(", ")}`);
}

/** Puts the banner where `place` says, reserved until the server answers,
 *  keeps it in step with the offer, and calls `onChange` when the offer first
 *  becomes known, starts or stops. `relabel` re-reads the words after a
 *  language change. */
export function mountPromo(place: (banner: HTMLElement) => void, words: () => PromoWords, lang: () => string, onChange: (view: PromoView) => void, onRender?: (view: PromoView) => void): { relabel(): void } {
  const banner = bannerElement();
  let view: PromoView | null = null;
  // Room is kept only for someone who last saw the offer running: while it is
  // off, nobody's pricing jumps on load.
  const KEY = "redaxa.promo.last-seen";
  let lastSeen = false;
  try { lastSeen = localStorage.getItem(KEY) === "active"; } catch { /* storage blocked: no reservation */ }
  if (lastSeen && Date.now() < PROMO_LAYOUT_UNTIL) {
    fillBanner(banner, null, words(), lang());
    place(banner);
  }
  watchPromo((next) => {
    const changed = view === null || Boolean(view.promo) !== Boolean(next.promo);
    view = next;
    if (changed) {
      try { localStorage.setItem(KEY, next.promo ? "active" : "off"); } catch { /* best effort */ }
      if (next.promo) {
        fillBanner(banner, next.promo, words(), lang());
        banner.style.removeProperty("visibility");
        banner.classList.remove("hw-offer-reserved");
        banner.removeAttribute("aria-hidden");
        banner.setAttribute("aria-labelledby", "redaxa-promo-title");
        if (!banner.isConnected) place(banner);
      } else {
        banner.remove();
      }
      onChange(next);
    }
    if (next.promo) clockBanner(banner, next.remaining, words());
    onRender?.(next);
  });
  return {
    relabel() {
      if (!banner.isConnected) return;
      fillBanner(banner, view?.promo ?? null, words(), lang());
      if (view?.promo) clockBanner(banner, view.remaining, words());
    },
  };
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
  kicker: "Halloween offer",
  lead: "At least {percent} off your first month or year.",
  ends: "Ends {date}.",
  fine: "Struck-through prices are our lowest in the 30 days before the offer. New subscriptions only; renewals are at the regular price, and eligible new subscribers still start with the 7-day trial. Prices exclude VAT.",
  endsIn: "Ends in",
  units: ["Days", "Hours", "Minutes", "Seconds"],
  thenMonth: "First month, then {price} a month",
  thenYear: "First year, then {price} a year",
  thenUserMonth: "First month, then {price} per user a month",
  thenUserYear: "First year, then {price} per user a year",
  perMonth: "/ month", perYear: "/ year", perUserMonth: "/ user / month", perUserYear: "/ user / year",
};

/* ---------- Top strip and headline card (landing page) ---------- */

export type OfferWords = {
  /** "{percent}" is replaced by the real percentage, e.g. "50%". */
  strip: string; stripShort: string; endsIn: string; cta: string; close: string;
  tag: string;
  /** "{price}" is replaced by the regular price that follows the first period. */
  plan: string;
  planMonth: string;
  /** "{date}" is replaced by the last minute on sale in the reader's zone. */
  ends: string;
};

export const OFFER_WORDS_EN: OfferWords = {
  strip: "Halloween offer · {percent} off",
  stripShort: "Halloween · −{percent}",
  endsIn: "Ends in",
  cta: "See the offer",
  close: "Dismiss the Halloween offer banner",
  tag: "HALLOWEEN",
  plan: "Pro · first year, then {price} / year",
  planMonth: "Pro · first month, then {price} / month",
  ends: "Ends {date}",
};

const ARROW = '<svg viewBox="0 0 14 10" width="14" height="10" aria-hidden="true" focusable="false"><path d="M1 5h11M8 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/** "27d 13h 05m 12s": the compact countdown of the strip. */
function stripClock(remaining: number): string {
  const [d, h, m, s] = promoClock(remaining);
  return `${Number(d)}d ${h}h ${m}m ${s}s`;
}

/** The strip and the card as plain DOM. Only static markup is written as HTML;
 *  every word and number reaches the page through textContent. */
function stripElement(): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "rx-strip";
  strip.innerHTML = `<div class="rx-strip-inner"><span class="rx-strip-pumpkin" aria-hidden="true">${HALLOWEEN_MARK_INK}</span>`
    + `<strong class="rx-strip-label"><span class="rx-strip-full"></span><span class="rx-strip-short"></span></strong>`
    + `<span class="rx-strip-timer" role="timer" aria-live="off"><span class="rx-strip-ends" aria-hidden="true"></span> <span class="rx-strip-digits" aria-hidden="true"></span></span>`
    + `<a class="rx-strip-cta" href="#pricing"></a><button type="button" class="rx-strip-close">${CROSS}</button></div>`;
  return strip;
}

function cardElement(): HTMLElement {
  const card = document.createElement("aside");
  card.className = "rx-hw-card";
  card.innerHTML = `<span class="rx-hw-card-mark" aria-hidden="true">${HALLOWEEN_MARK_EMBER}</span><span class="rx-hw-card-tag"></span>`
    + `<div class="rx-hw-card-row"><span class="rx-hw-card-now"></span><s class="rx-hw-card-was"></s><span class="rx-hw-card-pct"></span></div>`
    + `<span class="rx-hw-card-plan"></span><div class="rx-hw-card-foot"><span class="rx-hw-card-note"></span><a class="rx-hw-card-cta" href="#pricing"><span></span>${ARROW}</a></div>`;
  return card;
}

/** Puts a Halloween strip above the page and an offer card where `placeCard`
 *  says, from the offer the server published: Pro's first year, the same
 *  numbers as the plans below. Pass the returned function to mountPromo as its
 *  `onRender`. Nothing is drawn without a live offer; for someone who last
 *  saw the offer running, both keep their room (invisible) while the server
 *  answers, so the page does not jump. */
export function mountOfferExtras(words: OfferWords, lang: string, placeStrip: (strip: HTMLElement) => void, placeCard: (card: HTMLElement) => void): (view: PromoView) => void {
  const strip = stripElement();
  const card = cardElement();
  const label = (el: Element, selector: string, text: string) => { el.querySelector(selector)!.textContent = text; };
  const reserve = (el: HTMLElement) => { el.classList.add("rx-reserved"); el.setAttribute("aria-hidden", "true"); };
  const reveal = (el: HTMLElement) => { el.classList.remove("rx-reserved"); el.removeAttribute("aria-hidden"); };
  let lastSeen = false;
  try { lastSeen = localStorage.getItem("redaxa.promo.last-seen") === "active"; } catch { /* storage blocked: no reservation */ }
  if (lastSeen && Date.now() < PROMO_LAYOUT_UNTIL) {
    for (const el of [strip, card]) reserve(el);
    label(strip, ".rx-strip-full", words.strip.replace("{percent}", "50%"));
    label(strip, ".rx-strip-digits", "00d 00h 00m 00s");
    label(strip, ".rx-strip-cta", words.cta);
    label(card, ".rx-hw-card-now", "€00");
    label(card, ".rx-hw-card-was", "€00");
    label(card, ".rx-hw-card-plan", words.plan.replace("{price}", "€00"));
    label(card, ".rx-hw-card-note", words.ends.replace("{date}", "00"));
    label(card, ".rx-hw-card-cta span", words.cta);
    placeStrip(strip);
    placeCard(card);
  }
  let closedKey = "";
  let closed = false;
  strip.querySelector(".rx-strip-close")!.addEventListener("click", () => {
    closed = true;
    strip.remove();
    try { localStorage.setItem(closedKey, "1"); } catch { /* ignore */ }
  });
  strip.querySelector(".rx-strip-close")!.setAttribute("aria-label", words.close);
  let shownId = "";
  return (view) => {
    const promo = view.promo;
    const pro = view.offer("personal", "yearly") ?? view.offer("personal", "monthly");
    if (!promo || !pro) {
      strip.remove();
      card.remove();
      shownId = "";
      return;
    }
    if (shownId !== promo.id) {
      shownId = promo.id;
      closedKey = `redaxa.strip.${promo.id}`;
      try { closed = localStorage.getItem(closedKey) === "1"; } catch { closed = false; }
      if (closed) strip.remove();
      const percent = percentLabel(Math.min(...promo.offers.map(promoPercent)), lang);
      label(strip, ".rx-strip-full", words.strip.replace("{percent}", percent));
      label(strip, ".rx-strip-short", words.stripShort.replace("{percent}", percent));
      label(strip, ".rx-strip-ends", words.endsIn);
      label(strip, ".rx-strip-cta", words.cta);
      const yearly = pro.interval === "yearly";
      label(card, ".rx-hw-card-tag", words.tag);
      label(card, ".rx-hw-card-now", euro(pro.price, lang));
      label(card, ".rx-hw-card-was", euro(pro.reference, lang));
      label(card, ".rx-hw-card-pct", `−${percentLabel(promoPercent(pro), lang)}`);
      label(card, ".rx-hw-card-plan", (yearly ? words.plan : words.planMonth).replace("{price}", euro(pro.regular, lang)));
      label(card, ".rx-hw-card-note", words.ends.replace("{date}", promoEndLabel(promo, lang)));
      label(card, ".rx-hw-card-cta span", words.cta);
      card.setAttribute("aria-label", `${words.tag} ${percent}`);
      reveal(strip);
      reveal(card);
    }
    if (!card.isConnected) placeCard(card);
    if (!closed && !strip.isConnected) placeStrip(strip);
    label(strip, ".rx-strip-digits", stripClock(view.remaining));
    strip.querySelector(".rx-strip-timer")!.setAttribute("aria-label", `${words.endsIn} ${promoClock(view.remaining).slice(0, 3).map((v, i) => `${Number(v)} ${PROMO_WORDS_EN.units[i]}`).join(", ")}`);
  };
}
