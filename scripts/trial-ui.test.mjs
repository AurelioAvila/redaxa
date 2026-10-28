import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TRIAL_BANNER, TRIAL_UI, chargeDate, choiceCopy, keepArrow, longDay, parseBilling, parsePrices, planView } from "../dist/trial.js";

// What the plan cards say under "Start 3-day free trial" and "Subscribe now",
// from Stripe's price and the server's offer; never a number of its own.
const date = new Date("2026-10-17T10:00:00Z");
const pro = { plan: "personal", interval: "monthly", amount: 799, currency: "eur", taxBehavior: "exclusive", perSeat: false };
const team = { plan: "business", interval: "yearly", amount: 14990, currency: "eur", taxBehavior: "exclusive", perSeat: true };
const offer = { plan: "personal", interval: "monthly", regular: 799, reference: 799, price: 399, perSeat: false };
const nbsp = (s) => s.replace(/[\u00a0\u202f]/g, " ");

let copy = choiceCopy("en", { interval: "monthly", price: pro, promo: null, trialDays: 3, date });
assert.equal(copy.trialLabel, "Start 3-day free trial");
assert.equal(copy.nowLabel, "Subscribe now");
assert.equal(nbsp(copy.trialLine), "Free for 3 days, then €7.99 a month from 17 October 2026. Cancel before then and you pay nothing.");
assert.equal(copy.nowLine, "Or subscribe now: €7.99 today, no trial.");
copy = choiceCopy("en", { interval: "monthly", price: pro, promo: offer, trialDays: 3, date });
assert.equal(nbsp(copy.trialLine), "Free for 3 days, then €3.99 for the first month from 17 October 2026, and €7.99 a month after that. Cancel before then and you pay nothing.");
assert.equal(copy.nowLine, "Or subscribe now: €3.99 today, no trial.", "the offer is the first payment either way");
copy = choiceCopy("de", { interval: "yearly", price: team, promo: null, trialDays: 3, date });
assert.equal(copy.trialLabel, "3 Tage kostenlos testen");
assert.equal(nbsp(copy.trialLine), "3 Tage kostenlos, danach 149,90 € pro Nutzer und Jahr ab dem 17. Oktober 2026. Wenn Sie vorher kündigen, zahlen Sie nichts.");
assert.equal(nbsp(copy.nowLine), "Oder jetzt abonnieren: 149,90 € pro Nutzer heute, ohne Testphase.");
assert.ok(!/ \d{4}/.test(copy.trialLine.match(/\d+\.[^.]*\d{4}/)?.[0] ?? ""), "the date never breaks across lines");
// Without a price from Stripe the lines that would quote one are left out, not guessed.
copy = choiceCopy("it", { interval: "monthly", price: null, promo: null, trialDays: 3, date });
assert.equal(copy.trialLine, null);
assert.equal(copy.nowLine, null);
assert.equal(copy.trialLabel, "Inizia la prova gratuita di 3 giorni");
// Every language has every string, and none promises a refund.
for (const [lang, words] of Object.entries(TRIAL_UI)) {
  for (const key of Object.keys(TRIAL_UI.en)) assert.ok(words[key], `${lang}.${key}`);
  for (const key of Object.keys(TRIAL_UI.en.copy)) assert.ok(words.copy[key], `${lang}.copy.${key}`);
  assert.doesNotMatch(JSON.stringify(words), /refund|rimbors|reembols|rembours|erstatt|7-day|7 giorni|7 días|7 jours|7 Tage/i, lang);
}
assert.equal(longDay(date, "fr"), "17 octobre 2026");

// The trial ends where the server's clock says, not the device's.
const prices = parsePrices({ serverTime: "2026-10-14T10:00:00.000Z", trialEnabled: true, trialDays: 3, prices: [pro, { ...pro, amount: -1 }, { plan: "x" }] }, 1_000);
assert.equal(prices.prices.length, 1, "malformed prices are dropped");
assert.equal(chargeDate(prices, 61_000).toISOString(), "2026-10-17T10:01:00.000Z");
assert.equal(parsePrices({ prices: [] }), null);

// The account's billing view: anything unknown reads as not entitled, never as Pro.
assert.equal(parseBilling(null), null);
assert.equal(parseBilling({ trialEnabled: true, state: "pro" }), null);
const odd = parseBilling({ trialEnabled: true, state: "blocked", blockedReason: "something_new", canStartTrial: "yes" });
assert.equal(odd.blockedReason, "canceled");
assert.equal(odd.canStartTrial, false);
// Plans & pricing for every plan state: tiers below the one held are included, the held one is
// current, higher ones are upgrades; the trial is offered only to accounts without a plan.
const view = (held, billing, extra = {}) => planView({ held, paused: false, trialOn: true, signedIn: true, billing, ...extra });
const none = { state: "none", canStartTrial: true, trialUsed: false };
const cases = [
  ["signed out", view("free", null, { signedIn: false }), { free: "current", personal: "upgrade", business: "upgrade" }, "offer"],
  ["free, eligible", view("free", none), { free: "current", personal: "upgrade", business: "upgrade" }, "offer"],
  ["free, trial used", view("free", { state: "none", canStartTrial: false, trialUsed: true }), { free: "current", personal: "upgrade", business: "upgrade" }, "used"],
  ["free, trial refused", view("free", { state: "blocked", canStartTrial: false, trialUsed: true }), { free: "current", personal: "upgrade", business: "upgrade" }, "used"],
  ["free, former subscriber", view("free", { state: "blocked", canStartTrial: false, trialUsed: false }), { free: "current", personal: "upgrade", business: "upgrade" }, null],
  ["Pro trial", view("personal", { state: "trialing", canStartTrial: false, trialUsed: true }), { free: "included", personal: "current", business: "upgrade" }, "running"],
  ["Business trial", view("business", { state: "trialing", canStartTrial: false, trialUsed: true }), { free: "included", personal: "included", business: "current" }, "running"],
  ["Pro monthly or yearly", view("personal", { state: "active", canStartTrial: false, trialUsed: false }), { free: "included", personal: "current", business: "upgrade" }, null],
  ["Business (team)", view("business", { state: "active", canStartTrial: false, trialUsed: true }), { free: "included", personal: "included", business: "current" }, null],
  ["paused", view("free", { state: "blocked", canStartTrial: true, trialUsed: false }, { paused: true }), { free: "current", personal: "upgrade", business: "upgrade" }, null],
  ["trial switched off", view("free", none, { trialOn: false }), { free: "current", personal: "upgrade", business: "upgrade" }, null],
];
for (const [name, got, cards, trial] of cases) {
  assert.deepEqual(got.cards, cards, name);
  assert.equal(got.trial, trial, name);
}
// A paying account is never offered the trial, whatever the server's eligibility flag says.
assert.notEqual(view("business", { state: "active", canStartTrial: true, trialUsed: false }).trial, "offer");
for (const [lang, words] of Object.entries(TRIAL_BANNER)) for (const key of Object.keys(TRIAL_BANNER.en)) assert.ok(words[key], `${lang}.${key}`);
assert.match(TRIAL_BANNER.en.offerButton.replace("{days}", "3"), /^Start your 3-day free trial$/);
// The sidebar button's arrow stays on the line of its last word in every language (no breakable space before it).
for (const [lang, words] of Object.entries(TRIAL_BANNER)) {
  const side = keepArrow(words.sideOffer.replace("{days}", "3"));
  assert.match(side, /\S →$/u, `${lang}.sideOffer`);
}
assert.equal(keepArrow("Compare plans →"), "Compare plans →");
assert.equal(keepArrow("Confronta i piani"), "Confronta i piani");

// The trial is 3 days. No screen, dialog or static page of the web, desktop or extension client may promise
// the 7-day trial (only the Windows app 0.5.5 and older still gets it, as terms.html says).
const client = ["auth.ts", "dashboard.ts", "landing.ts", "repository-ui.ts", "promo.ts", "trial.ts", "dashboard.html", "index.html", "github.html",
  "browser-extension/popup.html", "browser-extension/popup.js", ...["en", "it", "es", "fr", "de"].map((l) => `browser-extension/_locales/${l}/messages.json`)];
const activity = /Last 7 days|Ultimi 7 giorni|Últimos 7 días|7 derniers jours|Letzte 7 Tage/g;
for (const file of client) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(activity, "");
  assert.doesNotMatch(text, /\b7[\s-]?(day|giorn|d[ií]as?\b|jours?\b|Tage\b|tägig)|seven[- ]day/i, file);
}
for (const [lang, words] of Object.entries(TRIAL_UI)) for (const key of ["plansIntro", "planNoneNote", "startTrialToInspect", "faqTrialQ"]) assert.match(words.copy[key], /\b3\b/, `${lang}.copy.${key}`);
// Copy shown before the server confirms the offer, or with the switch off: no choice is sent, and the
// server gives that checkout the same 3 days (api/billing.ts), so it says 3 days in every language.
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
for (const [file, pattern] of [["auth.ts", /try Redaxa free for 3 days[\s\S]*start with a 3-day free trial\."/], ["landing.ts", /start with a 3-day free trial\."\)/],
  ["repository-ui.ts", /start with a 3-day free trial\.'/], ["promo.ts", /still start with the 3-day free trial\./], ["dashboard.html", /start with a 3-day free trial\.<\/p>/]]) assert.match(source(file), pattern, file);
for (const phrase of ["3-day free trial", "prova gratuita di 3 giorni", "prueba gratuita de 3 días", "essai gratuit de 3 jours", "3-Tage-Testphase"]) {
  assert.ok(source("dashboard.ts").split(phrase).length - 1 >= 4, `dashboard.ts fallback copy: ${phrase}`);
}
assert.doesNotMatch(source("dashboard.ts"), /(prova gratuita|prueba gratuita|essai gratuit|kostenlose[nr]? Testphase|(?<!3-day )free trial)\./, "no fallback sentence without its length");
// French typography: a no-break space before : ; ! ? and a straight apostrophe never appears.
const flat = (o) => Object.values(o).flatMap((v) => typeof v === "string" ? [v] : flat(v));
for (const text of [...flat(TRIAL_UI.fr), ...flat(TRIAL_BANNER.fr)]) {
  assert.doesNotMatch(text, /\S [:;!?]/u, `fr: regular space before punctuation in "${text}"`);
  assert.doesNotMatch(text, /\p{L}'\p{L}/u, `fr: straight apostrophe in "${text}"`);
}
console.log("Trial screens: choice lines from Stripe prices and the offer, five languages, server clock, defensive account parsing, no 7-day promise anywhere passed.");
