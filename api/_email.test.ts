import assert from "node:assert/strict";
import { formatChargedAmount, passwordChangedHtml, passwordChangedText, planLabel, sendWelcomeEmail, subscriptionHtml, subscriptionSubject, subscriptionText, welcomeHtml, welcomeText } from "./_email.js";

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

// Every message goes out as HTML *and* text. HTML-only mail is a spam signal
// in itself, and a privacy product's subscription confirmation landing in junk
// is the worst possible first impression.
{
  const text = subscriptionText(base);
  assert.ok(!text.includes("<"), "the text part must not carry markup");
  assert.ok(text.includes("€6.99 / month"), "the price has to survive a client that strips HTML");
  assert.ok(text.includes("September 30, 2026"));
  assert.ok(text.includes("Renews on"), "a paid subscription renews; it is not a first charge");
}

{
  // The same distinction the HTML makes: during a trial nothing has been
  // charged yet, so "renews on" would be a lie about money.
  const text = subscriptionText({ ...base, trialing: true });
  assert.ok(text.includes("First charge"));
  assert.ok(!text.includes("Renews on"));
}

// The welcome: sent once, when an address is first confirmed. Supabase sends
// the confirmation link itself; nothing explained the product until this.
{
  const html = welcomeHtml("Giulia", "https://redaxa.app");
  const text = welcomeText("Giulia", "https://redaxa.app");
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Your account is confirmed, Giulia."));
  assert.ok(html.includes("display:none"), "an inbox preview line, or clients invent one");
  assert.ok(text.includes("Install the browser extension"));
  assert.ok(!text.includes("<"), "the text part must not carry markup");
}

{
  // A welcome that trains people to click authentication links out of an
  // inbox is teaching the exact habit that gets them phished — and this is a
  // product sold on not being careless with secrets.
  const html = welcomeHtml("Giulia", "https://redaxa.app");
  assert.ok(!/token=|access_token|reset|confirm[^e]/i.test(html), "no credential-shaped link belongs in a welcome");
}

{
  const html = welcomeHtml('<script>alert("x")</script>', "https://redaxa.app");
  assert.ok(!html.includes("<script>"), "the name must be escaped into the markup");
  assert.ok(html.includes("&lt;script&gt;"));
}

{
  // No name is not an error; it just loses the name.
  assert.ok(welcomeHtml(null, "https://redaxa.app").includes("confirmed, there."));
}

// The sender has no default. It used to fall back to an address on a domain
// this project does not send from, which Resend refuses — producing no mail,
// one unread console line, and a `false` every best-effort caller ignores.
{
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.REDAXA_MAIL_FROM;
  const sent: unknown[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return new Response("{}", { status: 200 });
  }) as typeof globalThis.fetch;

  try {
    process.env.RESEND_API_KEY = "re_test";
    delete process.env.REDAXA_MAIL_FROM;
    assert.equal(
      await sendWelcomeEmail("someone@example.com", "Giulia", "https://redaxa.app"),
      false,
      "an unconfigured sender must refuse rather than guess a domain",
    );
    assert.equal(sent.length, 0, "nothing may be handed to the provider");

    process.env.REDAXA_MAIL_FROM = "Redaxa <noreply@example.com>";
    assert.equal(
      await sendWelcomeEmail("someone@example.com", "Giulia", "https://redaxa.app"),
      true,
    );
    assert.equal(sent.length, 1);
    const payload = sent[0] as { from: string; text: string; html: string; reply_to: string };
    assert.equal(payload.from, "Redaxa <noreply@example.com>");
    // The subscription email tells the reader to reply. Sent from a noreply@
    // address, that promise is only true if a Reply-To carries it somewhere.
    assert.ok(payload.reply_to, "every message must be replyable");
    assert.ok(payload.reply_to.includes("@"));
    assert.ok(payload.text, "every message carries a text part");
    assert.ok(payload.html);
  } finally {
    globalThis.fetch = realFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.REDAXA_MAIL_FROM;
    else process.env.REDAXA_MAIL_FROM = previousFrom;
  }
}

// The notice sent once a password has actually changed. Redaxa was the only
// product without one, because the password changes inside Supabase and
// Supabase sends nothing.
{
  const when = "Mon, 01 Sep 2026 10:00:00 GMT";
  const html = passwordChangedHtml("Giulia", when);
  const text = passwordChangedText("Giulia", when);

  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Your password was changed, Giulia."));
  assert.ok(html.includes(when));
  assert.ok(html.includes("display:none"), "an inbox preview line, or clients invent one");
  assert.ok(text.includes("reply to this message straight away"));
  assert.ok(!text.includes("<"), "the text part must not carry markup");
}

{
  // No link and no code, deliberately. Whoever reads this is not necessarily
  // the person who made the change — that is why it exists — and by then the
  // new password is set, so a "this wasn't me" button is the exact shape an
  // attacker would forge on the one message a worried reader will click.
  const html = passwordChangedHtml("Giulia", "Mon, 01 Sep 2026 10:00:00 GMT");
  assert.ok(!/href=/i.test(html), "a security notice must offer nothing to click");
  assert.ok(!/token=|reset|code/i.test(html), "and nothing worth forging");
}

{
  const html = passwordChangedHtml('<script>alert("x")</script>', "now");
  assert.ok(!html.includes("<script>"), "the name must be escaped into the markup");
  assert.ok(html.includes("&lt;script&gt;"));
}

console.log("Redaxa email tests passed.");
