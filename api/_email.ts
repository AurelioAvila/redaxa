/**
 * The email a customer gets when their Redaxa subscription begins.
 *
 * Until now nothing was sent at all: the webhook recorded the subscription
 * and the person heard from Stripe's receipt and nobody else. That is the
 * one moment a customer is most likely to wonder whether the payment worked,
 * and the product had no answer for them.
 *
 * The layout deliberately matches the one PC Tweaker sends — same structure,
 * same tone, Redaxa's own words and colour. Someone who buys two products
 * from the same person should not receive mail from what looks like two
 * unrelated companies.
 *
 * Sending is best-effort by design. A failure here must never fail the
 * webhook: Stripe would retry the whole delivery and re-run everything that
 * already succeeded, and the customer's access does not depend on the mail.
 */

const ACCENT = "#7c5cfc";
// The old #5b5f66 on the #0a0a0c card was 3.1:1 — under AA for the 13px it is used at,
// and it carries the footer line about never asking for a password. This is 5.2:1.
const MUTED = "#7e848c";
// Sale notices go to Redaxa's own support alias (forwarded to the owner), never
// a personal inbox written into a public repository.
const OWNER_INBOX = process.env.OWNER_INBOX || "redaxa@getcertsprint.com";

/**
 * The sending address. No default, deliberately.
 *
 * This used to fall back to `Redaxa <noreply@redaxa.app>` when the variable
 * was unset — an address on a domain this project does not send from. Resend
 * refuses to send from a domain that has not been verified on the account, so
 * the fallback did not produce wrong mail; it produced *no* mail, a 4xx, one
 * console line nobody reads, and a `false` every caller ignores because every
 * caller is deliberately best-effort. A subscription confirmation that simply
 * never arrives, with nothing anywhere reporting a fault, is the worst shape
 * a bug of this kind can take.
 *
 * Returning null instead makes the misconfiguration loud at the one moment it
 * can still be acted on, and `send` refuses rather than guessing.
 */
function sender(): string | null {
  const from = process.env.REDAXA_MAIL_FROM?.trim();
  return from ? from : null;
}

export type SubscriptionEmailInput = {
  to: string;
  firstName?: string | null;
  /** "personal" or "business". Anything else is shown as given. */
  plan: string | null;
  /** "month" or "year". */
  interval: string | null;
  /** What Stripe will charge, already formatted. Null when unknown, and the
   *  row is then left out rather than guessed at. */
  priceLabel: string | null;
  /** Pre-formatted date of the first or next charge, or null. */
  renewsOn: string | null;
  /** True while the subscription is in its free trial, which changes what
   *  this email can honestly claim. */
  trialing: boolean;
  appUrl: string;
};

/** "Lead, Name." or just "Lead." — welcomeOnce never has a name, and
 *  "Your account is confirmed, there." read like a mail-merge slip. */
function greet(lead: string, firstName: string | null | undefined, html: boolean): string {
  const name = firstName?.trim();
  return name ? `${lead}, ${html ? escapeHtml(name) : name}.` : `${lead}.`;
}

// Same metas as supabase/email-templates: the design is dark on purpose, and
// clients that would otherwise "fix" it for dark mode are told it already is.
// The media query only tightens the 40px gutters and 32px headings on phones.
const HEAD_EXTRA = `<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<style>
@media only screen and (max-width:620px){
.rx-pad{padding-left:22px!important;padding-right:22px!important}
.rx-h1{font-size:26px!important}
}
</style>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The bare host of the app URL, so the footer names the site the link
 *  actually goes to. Hard-coding "redaxa.app" would print a domain that is
 *  not yet where the product lives. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

export function planLabel(plan: string | null, interval: string | null): string {
  // Legacy metadata sometimes contains a billing cadence instead of a tier.
  // Do not invent an entitlement or repeat "monthly — Monthly".
  const cadenceOnly = ["month", "monthly", "year", "yearly", "annual"].includes((plan || "").toLowerCase());
  const name = plan === "business" ? "Business" : plan === "personal" || plan === "pro" ? "Pro" : cadenceOnly ? "Redaxa" : plan || "Redaxa";
  const cadence = interval === "year" ? "Yearly" : interval === "month" ? "Monthly" : null;
  return cadence ? `${name} — ${cadence}` : name;
}

export function subscriptionSubject(trialing: boolean): string {
  return trialing ? "Your Redaxa trial has started" : "Your Redaxa subscription is confirmed";
}

/**
 * Outlook renders with Word, which drops padding on an inline anchor: the
 * button collapses into a bare text link. VML is the one shape it draws
 * reliably, so Outlook gets the rectangle and every other client gets the
 * anchor. The width is a parameter because VML cannot size itself to its text.
 */
function button(href: string, label: string, width: number): string {
  const safeHref = escapeHtml(href);
  return `<!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:54px;v-text-anchor:middle;width:${width}px;" arcsize="22%" stroke="f" fillcolor="${ACCENT}">
              <w:anchorlock/>
              <center style="color:#0a0a0c;font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:800;">${label}</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="${safeHref}" style="display:inline-block; background:${ACCENT}; color:#0a0a0c; font-size:16px; font-weight:800; text-decoration:none; padding:16px 36px; border-radius:12px; letter-spacing:-0.2px;">${label}</a>
            <!--<![endif]-->`;
}

export function subscriptionHtml(input: SubscriptionEmailInput): string {
  const { firstName, plan, interval, priceLabel, renewsOn, trialing, appUrl } = input;
  const headline = greet(trialing ? "Your trial is running" : "You're all set", firstName, true);
  const intro = trialing
    ? "Your seven-day trial of Redaxa has started. Everything below is unlocked for the whole trial, and nothing is charged until it ends."
    : "Thanks for subscribing to Redaxa. Your account is active and everything below is unlocked — no extra setup needed.";
  // "Renews on" is wrong during a trial: nothing has been paid yet, so the
  // date is when the first charge happens, not a renewal.
  const dateLabel = trialing ? "First charge" : "Renews on";

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${HEAD_EXTRA}
<title>Redaxa</title>
</head>
<body style="margin:0; padding:0; background:#050506; font-family:'Segoe UI', Arial, sans-serif;">
<!-- The line an inbox shows next to the subject. Without it, clients scrape
     the first words of the body, which here is the eyebrow "Trial Started"
     repeated - the reader learns nothing they did not already see. -->
<div lang="en" dir="ltr" style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(intro)}</div>
<table lang="en" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#050506" style="background:#050506; padding:48px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" bgcolor="#0a0a0c" style="max-width:560px; width:100%; background:#0a0a0c; border:1px solid #2a2d33; border-radius:20px; overflow:hidden;">

        <tr>
          <td class="rx-pad" style="background:radial-gradient(circle at 20% 0%, ${ACCENT}4d 0%, transparent 60%), #0a0a0c; padding:40px 40px 32px; text-align:center;">
            <div style="font-size:15px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${ACCENT};">
              ${trialing ? "Trial Started" : "Subscription Active"}
            </div>
          </td>
        </tr>

        <tr>
          <td class="rx-pad" style="padding:0 40px; text-align:center;">
            <h1 class="rx-h1" style="margin:0; font-size:32px; line-height:1.25; font-weight:800; color:#f3f4f6; letter-spacing:-0.5px;">
              ${headline}
            </h1>
            <p style="margin:16px 0 0; font-size:16px; line-height:1.6; color:#9ca3af;">
              ${intro}
            </p>
          </td>
        </tr>

        <tr><td class="rx-pad" style="padding:32px 40px 0;"><div style="height:1px; background:#2a2d33;"></div></td></tr>

        <tr>
          <td class="rx-pad" style="padding:28px 40px 0;">
            <div style="font-size:13px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:${MUTED}; margin-bottom:16px;">What you've unlocked</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:10px 0; color:#e5e7eb; font-size:15px; line-height:1.5;">
                  <span style="color:${ACCENT}; font-weight:700;">&rarr;</span>&nbsp; Prompt checks on the web, in the Windows app and in the Chrome extension
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0; color:#e5e7eb; font-size:15px; line-height:1.5;">
                  <span style="color:${ACCENT}; font-weight:700;">&rarr;</span>&nbsp; Local reviews of repositories for exposed secrets, in the Windows app
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0; color:#e5e7eb; font-size:15px; line-height:1.5;">
                  <span style="color:${ACCENT}; font-weight:700;">&rarr;</span>&nbsp; ${plan === "business" ? "Shared policies and an activity log for up to three seats" : "Every finding explained, with a redacted version ready to paste"}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="rx-pad" style="padding:32px 40px 8px; text-align:center;">
            ${button(appUrl, "Open Redaxa", 200)}
          </td>
        </tr>

        <tr><td class="rx-pad" style="padding:32px 40px 0;"><div style="height:1px; background:#2a2d33;"></div></td></tr>
        <tr>
          <td class="rx-pad" style="padding:24px 40px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:13px; color:${MUTED}; padding:4px 0;">Plan</td>
                <td style="font-size:13px; color:#e5e7eb; padding:4px 0; text-align:right;">${escapeHtml(planLabel(plan, interval))}</td>
              </tr>
              ${
                priceLabel
                  ? `<tr>
                <td style="font-size:13px; color:${MUTED}; padding:4px 0;">Price</td>
                <td style="font-size:13px; color:#e5e7eb; padding:4px 0; text-align:right;">${escapeHtml(priceLabel)}</td>
              </tr>`
                  : ""
              }
              ${
                renewsOn
                  ? `<tr>
                <td style="font-size:13px; color:${MUTED}; padding:4px 0;">${dateLabel}</td>
                <td style="font-size:13px; color:#e5e7eb; padding:4px 0; text-align:right;">${escapeHtml(renewsOn)}</td>
              </tr>`
                  : ""
              }
            </table>
          </td>
        </tr>

        <tr>
          <td class="rx-pad" style="padding:32px 40px 40px; text-align:center;">
            <p style="margin:0; font-size:13px; color:${MUTED}; line-height:1.6;">
              Cancel anytime from your account settings. Questions? Just reply to this email.<br>
              Redaxa &middot; <a href="${escapeHtml(appUrl)}" style="color:${MUTED};">${escapeHtml(hostOf(appUrl))}</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * Formats what Stripe charges, from the price itself rather than a table of
 * plan names. A table has to be kept in step with the dashboard by hand and
 * lies silently the moment it is not.
 */
export function formatChargedAmount(
  amountInMinorUnits: number | null | undefined,
  currency: string | null | undefined,
  interval?: string | null,
): string | null {
  if (amountInMinorUnits == null || !currency) return null;
  // Zero-decimal currencies are not divided by a hundred; doing it anyway
  // would quote a hundredth of the real price.
  const zeroDecimal = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
  const code = currency.toLowerCase();
  const amount = zeroDecimal.has(code) ? amountInMinorUnits : amountInMinorUnits / 100;
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: zeroDecimal.has(code) ? 0 : 2,
    })
      .format(amount)
      // Intl separates an unrecognised currency code from the number with
      // a non-breaking space: it looks identical and compares unequal, so
      // it is written as an escape rather than an invisible character.
      .replace(/ /g, " ");
  } catch {
    formatted = `${amount} ${currency.toUpperCase()}`;
  }
  return interval ? `${formatted} / ${interval}` : `${formatted} once`;
}

/**
 * The one way out to Resend.
 *
 * `text` is not optional. Everything here used to go as HTML only, which spam
 * filters treat as a signal in its own right — and for a product sold on
 * privacy, a subscription confirmation landing in junk is the worst possible
 * first impression. Every caller now has to say what the message reads as
 * without markup.
 */
async function send(to: string, subject: string, html: string, text: string, idempotencyKey?: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  const from = sender();
  if (!from) {
    console.error("redaxa mail not sent: RESEND_API_KEY is set but REDAXA_MAIL_FROM is not");
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      // reply_to, because the subscription email says "Questions? Just reply
      // to this email" and the address it is sent from is a noreply@. A
      // promise in the copy that the transport quietly breaks is worse than
      // not making it: the customer writes, hears nothing, and concludes
      // there is nobody there.
      body: JSON.stringify({ from, to, subject, html, text, reply_to: "redaxa@getcertsprint.com" }),
    });
    if (!response.ok) {
      console.error("redaxa mail failed", response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("redaxa mail request failed");
    return false;
  }
}

/** The same message with the markup taken away. Kept next to the HTML so the
 *  two cannot say different things about what was charged. */
export function subscriptionText(input: SubscriptionEmailInput): string {
  const { firstName, plan, interval, priceLabel, renewsOn, trialing, appUrl } = input;
  const lines = [
    greet(trialing ? "Your trial is running" : "You're all set", firstName, false),
    "",
    trialing
      ? "Your seven-day trial of Redaxa has started. Everything is unlocked for the whole trial, and nothing is charged until it ends."
      : "Thanks for subscribing to Redaxa. Your account is active and everything is unlocked - no extra setup needed.",
    "",
    "What you've unlocked:",
    "- Prompt checks on the web, in the Windows app and in the Chrome extension",
    "- Local reviews of repositories for exposed secrets, in the Windows app",
    plan === "business"
      ? "- Shared policies and an activity log for up to three seats"
      : "- Every finding explained, with a redacted version ready to paste",
    "",
    `Plan: ${planLabel(plan, interval)}`,
  ];
  if (priceLabel) lines.push(`Price: ${priceLabel}`);
  if (renewsOn) lines.push(`${trialing ? "First charge" : "Renews on"}: ${renewsOn}`);
  lines.push("", `Open Redaxa: ${appUrl}`, "", "Cancel anytime from your account settings. Questions? Just reply to this email.");
  return lines.join("\n");
}

/** Tells the customer their subscription started. Never throws. The key,
 *  derived from the subscription, makes a duplicate webhook delivery that
 *  runs in parallel harmless: Resend sends one message per key. */
export async function sendSubscriptionEmail(input: SubscriptionEmailInput, idempotencyKey?: string): Promise<boolean> {
  return send(input.to, subscriptionSubject(input.trialing), subscriptionHtml(input), subscriptionText(input), idempotencyKey);
}

/**
 * The first message a new account gets from us.
 *
 * Supabase sends the confirmation itself, from its own default template. What
 * it does not send is anything that explains the product — so until this
 * existed, someone confirmed an address and heard nothing further until they
 * happened to pay. It goes out once, on the first confirmed sign-in.
 *
 * Deliberately no credentials, no link with a token in it, and nothing to
 * click other than the app: a privacy product whose welcome mail trains
 * people to click authentication links out of an inbox is teaching the exact
 * habit that gets them phished.
 */
export function welcomeHtml(firstName: string | null | undefined, appUrl: string): string {
  const intro = "Redaxa helps you review prompts for sensitive details before sharing them with AI. Web and Windows checks are processed by Redaxa's scanner without storing the prompt text or forwarding it to an AI provider.";
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${HEAD_EXTRA}
<title>Redaxa</title>
</head>
<body style="margin:0; padding:0; background:#050506; font-family:'Segoe UI', Arial, sans-serif;">
<div lang="en" dir="ltr" style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(intro)}</div>
<table lang="en" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#050506" style="background:#050506; padding:48px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" bgcolor="#0a0a0c" style="max-width:560px; width:100%; background:#0a0a0c; border:1px solid #2a2d33; border-radius:20px; overflow:hidden;">

        <tr>
          <td class="rx-pad" style="background:radial-gradient(circle at 20% 0%, ${ACCENT}4d 0%, transparent 60%), #0a0a0c; padding:40px 40px 32px; text-align:center;">
            <div style="font-size:15px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${ACCENT};">Welcome</div>
          </td>
        </tr>

        <tr>
          <td class="rx-pad" style="padding:0 40px; text-align:center;">
            <h1 class="rx-h1" style="margin:0; font-size:32px; line-height:1.25; font-weight:800; color:#f3f4f6; letter-spacing:-0.5px;">${greet("Your account is confirmed", firstName, true)}</h1>
            <p style="margin:16px 0 0; font-size:16px; line-height:1.6; color:#9ca3af;">${escapeHtml(intro)}</p>
          </td>
        </tr>

        <tr><td class="rx-pad" style="padding:32px 40px 0;"><div style="height:1px; background:#2a2d33;"></div></td></tr>

        <tr>
          <td class="rx-pad" style="padding:28px 40px 0;">
            <div style="font-size:13px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:${MUTED}; margin-bottom:16px;">Three minutes to set up</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:10px 0; color:#e5e7eb; font-size:15px; line-height:1.5;"><span style="color:${ACCENT}; font-weight:700;">1</span>&nbsp;&nbsp; Install the browser extension or the desktop app</td></tr>
              <tr><td style="padding:10px 0; color:#e5e7eb; font-size:15px; line-height:1.5;"><span style="color:${ACCENT}; font-weight:700;">2</span>&nbsp;&nbsp; Open ChatGPT, Claude, Gemini or Copilot as you normally would</td></tr>
              <tr><td style="padding:10px 0; color:#e5e7eb; font-size:15px; line-height:1.5;"><span style="color:${ACCENT}; font-weight:700;">3</span>&nbsp;&nbsp; Paste something with a key or an address in it and watch it get masked</td></tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="rx-pad" style="padding:32px 40px 8px; text-align:center;">
            ${button(appUrl, "Open Redaxa", 200)}
          </td>
        </tr>

        <tr>
          <td class="rx-pad" style="padding:32px 40px 40px; text-align:center;">
            <p style="margin:0; font-size:13px; color:${MUTED}; line-height:1.6;">
              We will never ask you for a password or an API key by email.<br>
              Redaxa &middot; <a href="${escapeHtml(appUrl)}" style="color:${MUTED};">${escapeHtml(hostOf(appUrl))}</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function welcomeText(firstName: string | null | undefined, appUrl: string): string {
  return [
    greet("Your account is confirmed", firstName, false),
    "",
    "Redaxa helps you review prompts for sensitive details before sharing them with AI. Web and Windows checks are processed by Redaxa's scanner without storing the prompt text or forwarding it to an AI provider.",
    "",
    "Three minutes to set up:",
    "1. Install the browser extension or the desktop app",
    "2. Open ChatGPT, Claude, Gemini or Copilot as you normally would",
    "3. Paste something with a key or an address in it and watch it get masked",
    "",
    `Open Redaxa: ${appUrl}`,
    "",
    "We will never ask you for a password or an API key by email.",
  ].join("\n");
}

/**
 * The notice sent once a password has actually changed.
 *
 * Redaxa was the only one of the products without this, and the only one
 * where the password does not change inside its own code — Supabase owns
 * that, and Supabase sends nothing. The reset now goes through our own
 * endpoint precisely so this can be true: the notice follows a change that
 * really happened, rather than a request that might not have.
 *
 * No link and no code in it, deliberately. Whoever reads this is not
 * necessarily the person who made the change — that is the entire reason it
 * exists — but by the time it arrives the new password is already set, so a
 * "this wasn't me" button would be the exact shape an attacker would forge,
 * on the one message a worried reader is most likely to click.
 */
export function passwordChangedHtml(firstName: string | null | undefined, when: string): string {
  const intro = `The password on your Redaxa account was changed on ${escapeHtml(when)}.`;
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${HEAD_EXTRA}
<title>Redaxa</title>
</head>
<body style="margin:0; padding:0; background:#050506; font-family:'Segoe UI', Arial, sans-serif;">
<div lang="en" dir="ltr" style="display:none; max-height:0; overflow:hidden; opacity:0;">${intro}</div>
<table lang="en" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#050506" style="background:#050506; padding:48px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" bgcolor="#0a0a0c" style="max-width:560px; width:100%; background:#0a0a0c; border:1px solid #2a2d33; border-radius:20px; overflow:hidden;">

        <tr>
          <td class="rx-pad" style="background:radial-gradient(circle at 20% 0%, ${ACCENT}4d 0%, transparent 60%), #0a0a0c; padding:40px 40px 32px; text-align:center;">
            <div style="font-size:15px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${ACCENT};">Security notice</div>
          </td>
        </tr>

        <tr>
          <td class="rx-pad" style="padding:0 40px; text-align:center;">
            <h1 class="rx-h1" style="margin:0; font-size:32px; line-height:1.25; font-weight:800; color:#f3f4f6; letter-spacing:-0.5px;">${greet("Your password was changed", firstName, true)}</h1>
            <p style="margin:16px 0 0; font-size:16px; line-height:1.6; color:#9ca3af;">${intro}</p>
          </td>
        </tr>

        <tr><td class="rx-pad" style="padding:32px 40px 0;"><div style="height:1px; background:#2a2d33;"></div></td></tr>

        <tr>
          <td class="rx-pad" style="padding:28px 40px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12; border:1px solid #2a2d33; border-radius:12px;">
              <tr><td style="padding:18px; color:#9ca3af; font-size:15px; line-height:1.6;">If this was you, nothing else is needed.<br>If it was not, reply to this message straight away — somebody else set that password.</td></tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="rx-pad" style="padding:32px 40px 40px; text-align:center;">
            <p style="margin:0; font-size:13px; color:${MUTED}; line-height:1.6;">
              We will never ask you for your password by email.<br>
              This notice is sent every time the password changes and cannot be turned off.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function passwordChangedText(firstName: string | null | undefined, when: string): string {
  return [
    greet("Your password was changed", firstName, false),
    "",
    `The password on your Redaxa account was changed on ${when}.`,
    "",
    "If this was you, nothing else is needed. If it was not, reply to this message straight away - somebody else set that password.",
    "",
    "We will never ask you for your password by email.",
  ].join("\n");
}

/** Sends the notice. Never throws; the password has already changed. */
export async function sendPasswordChangedEmail(to: string, firstName: string | null | undefined): Promise<boolean> {
  const when = new Date().toUTCString();
  return send(
    to,
    "Your Redaxa password was changed",
    passwordChangedHtml(firstName, when),
    passwordChangedText(firstName, when),
  );
}

/** Sends the welcome. Never throws; the caller has already succeeded. */
export async function sendWelcomeEmail(to: string, firstName: string | null | undefined, appUrl: string, userId?: string): Promise<boolean> {
  return send(to, "Welcome to Redaxa", welcomeHtml(firstName, appUrl), welcomeText(firstName, appUrl), userId ? `redaxa-welcome/${userId}` : undefined);
}

/** Tells the owner a sale happened. Never throws, and never blocks the
 *  customer's email on its own failure. */
export async function notifyOwnerOfSale(
  customerEmail: string,
  plan: string | null,
  interval: string | null,
  trialing: boolean,
  idempotencyKey?: string,
): Promise<boolean> {
  const label = planLabel(plan, interval);
  return send(
    OWNER_INBOX,
    `New Redaxa ${trialing ? "trial" : "subscription"} — ${label}`,
    `<p>Someone just started a Redaxa ${trialing ? "trial" : "subscription"}.</p>
     <p><strong>Plan:</strong> ${escapeHtml(label)}<br>
        <strong>Account:</strong> ${escapeHtml(customerEmail || "(unknown address)")}</p>
     <p>Stripe has the details; this is only the heads-up.</p>`,
    `Someone just started a Redaxa ${trialing ? "trial" : "subscription"}.\n\nPlan: ${label}\nAccount: ${customerEmail || "(unknown address)"}\n\nStripe has the details; this is only the heads-up.`,
    idempotencyKey,
  );
}
