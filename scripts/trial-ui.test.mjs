import assert from "node:assert/strict";
import { TRIAL_UI, chargeDate, choiceCopy, longDay, parseBilling, parsePrices } from "../dist/trial.js";

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
console.log("Trial screens: choice lines from Stripe prices and the offer, five languages, server clock, defensive account parsing passed.");
