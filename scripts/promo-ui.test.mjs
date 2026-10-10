import assert from "node:assert/strict";
import { euro, msUntil, parsePromo, percentLabel, promoClock, promoPercent } from "../dist/promo.js";

const offer = { plan: "business", interval: "monthly", currency: "eur", regular: 1499, reference: 1499, price: 749, percentOff: 50, perSeat: true, firstPeriodOnly: true };
const active = { serverTime: "2026-11-06T22:59:00.000Z", id: "halloween50-2026", status: "active", startsAt: "2026-10-10T00:00:00.000Z", endsAt: "2026-11-06T23:00:00.000Z", offers: [offer] };

// A server response becomes an offer; nothing else does.
assert.equal(parsePromo(active).offers.length, 1);
for (const bad of [null, {}, "active", { ...active, status: "disabled" }, { ...active, endsAt: "soon" }, { ...active, offers: "x" }, { ...active, id: 7 }]) {
  assert.equal(parsePromo(bad), null, JSON.stringify(bad));
}
// A "discount" that is not below the struck price, or not in euro cents, is never drawn,
// and an "active" answer left with nothing valid is no offer at all.
for (const broken of [{ price: 1499 }, { price: 1500 }, { reference: 1600 }, { price: 749.5 }, { currency: "usd" }, { perSeat: "yes" }, { firstPeriodOnly: false }, { regular: -1 }]) {
  assert.equal(parsePromo({ ...active, offers: [{ ...offer, ...broken }] }), null, JSON.stringify(broken));
}
// A scheduled offer publishes no prices.
assert.deepEqual(parsePromo({ ...active, status: "scheduled" }).offers, []);

// The badge is rounded down and measured against the struck price.
assert.equal(promoPercent(offer), 50);
assert.equal(promoPercent({ reference: 1000, price: 801 }), 19);
assert.equal(percentLabel(50, "en"), "50%");
assert.equal(percentLabel(50, "it"), "50%");
assert.match(percentLabel(50, "fr"), /^50\s%$/u);
assert.equal(euro(749, "en"), "€7.49");
assert.match(euro(749, "it"), /^7,49\s€$/u);

// The deadline runs on the server's clock plus elapsed time: one minute left,
// gone after it, whatever the device's own clock says.
assert.equal(msUntil(active, active.endsAt, 0), 60_000);
assert.ok(msUntil(active, active.endsAt, 60_000) <= 0);
assert.equal(msUntil(active, active.endsAt, -5_000), 60_000, "negative elapsed time cannot extend the offer");

// Days, hours, minutes and seconds, stopping at zero.
assert.deepEqual(promoClock(27 * 86_400_000 + 13 * 3_600_000 + 5 * 60_000 + 12_000), ["27", "13", "05", "12"]);
for (const ms of [999, -5000, Number.NaN]) assert.deepEqual(promoClock(ms), ["00", "00", "00", "00"]);

console.log("Promo display: parsing, honest percentages, server-clock countdown and fallback passed.");
