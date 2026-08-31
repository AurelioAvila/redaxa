import assert from "node:assert/strict";
import { formatChargedAmount, planLabel, subscriptionHtml, subscriptionSubject } from "./_email.js";

const base = {
  to: "buyer@example.com",
  firstName: "Giulia",
  plan: "personal",
  interval: "month",
  priceLabel: "€6.99 / month",
  renewsOn: "September 30, 2026",
  trialing: false,
  appUrl: "https://redaxa.app",
};

// A trial has charged nobody anything. Telling someone their subscription is
// confirmed, and quoting a renewal date, would be two false statements in the
// one email they are most likely to read carefully.
{
  const html = subscriptionHtml({ ...base, trialing: true });
  assert.equal(subscriptionSubject(true), "Your Redaxa trial has started");
  assert.ok(html.includes("First charge"), "a trial must not call the date a renewal");
  assert.ok(!html.includes("Renews on"), "a trial must not claim a renewal");
  assert.ok(html.includes("nothing is charged until it ends"));
}

{
  const html = subscriptionHtml(base);
  assert.equal(subscriptionSubject(false), "Your Redaxa subscription is confirmed");
  assert.ok(html.includes("Renews on"));
  assert.ok(!html.includes("First charge"));
  assert.ok(html.includes("€6.99 / month"));
}

// An unknown price must leave the row out rather than print a confident zero.
{
  const html = subscriptionHtml({ ...base, priceLabel: null, renewsOn: null });
  assert.ok(!html.includes("Price"), "an unknown price should be omitted, not guessed");
  assert.ok(!html.includes("Renews on"));
  assert.ok(html.includes("Personal"), "the plan is still named");
}

// The buyer's own name reaches the markup, so it has to be escaped.
{
  const html = subscriptionHtml({ ...base, firstName: '<script>alert("x")</script>' });
  assert.ok(!html.includes("<script>"), "the name must be escaped into the markup");
  assert.ok(html.includes("&lt;script&gt;"));
}

assert.equal(planLabel("business", "year"), "Business — Yearly");
assert.equal(planLabel("personal", "month"), "Personal — Monthly");
assert.equal(planLabel(null, null), "Redaxa");

// Read from the price rather than a table of plan names, which would drift
// from the dashboard silently.
assert.equal(formatChargedAmount(699, "eur", "month"), "€6.99 / month");
assert.equal(formatChargedAmount(5900, "eur", null), "€59.00 once");
// Zero-decimal currencies are not divided by a hundred.
assert.equal(formatChargedAmount(5900, "jpy", "year"), "¥5,900 / year");
assert.equal(formatChargedAmount(null, "eur", "month"), null);

console.log("Redaxa email tests passed.");
