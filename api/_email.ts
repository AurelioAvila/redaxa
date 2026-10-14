/**
 * Every email Redaxa sends itself, in one layout: the Paper palette with its
 * copper accent (the site's default), and Ink & Copper for readers whose mail
 * app is dark. The Supabase Auth templates are generated from the same
 * renderer (scripts/build-auth-email-templates.ts), so a confirmation link and
 * a subscription receipt look like they came from the same product.
 *
 * Sending is best-effort by design. A failure here must never fail the
 * webhook: Stripe would retry the whole delivery and re-run everything that
 * already succeeded, and the customer's access does not depend on the mail.
 */

// Sale notices go to Redaxa's own support alias (forwarded to the owner), never
// a personal inbox written into a public repository.
const OWNER_INBOX = process.env.OWNER_INBOX || "redaxa@getcertsprint.com";
/** Where replies and questions go; every message names it. */
export const SUPPORT_ADDRESS = "redaxa@getcertsprint.com";
/** The public site. Links, logo and footer all point here, whatever host sent the mail. */
export const SITE_URL = "https://redaxa.getcertsprint.com";

/**
 * The sending address. No default, deliberately: an unset variable used to
 * fall back to a domain this project does not send from, which Resend refuses
 * — no mail, one console line nobody reads, and a `false` every best-effort
 * caller ignores. `send` refuses rather than guessing.
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Lead, Name." or just "Lead." — "Your account is confirmed, there." read like a mail-merge slip. */
function greet(lead: string, firstName: string | null | undefined): string {
  const name = firstName?.trim();
  return name ? `${lead}, ${name}.` : `${lead}.`;
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

// Paper (light) and Ink & Copper (dark), from themes.css. Contrast on the card:
// ink 16.9:1, body 9.6:1, muted 6.9:1, white on copper 6.4:1; dark: text on
// card 15.2:1, muted 8.0:1, button ink on copper 7.4:1.
const P = { page: "#f7f6f2", card: "#ffffff", inset: "#f2f0ea", line: "#e3dfd5", ink: "#1b1724", body: "#3f3a4a", muted: "#5a5466", copper: "#a3471d" };
const SANS = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;";

/** A content block. Strings are plain text; the renderer escapes them. */
export type Block =
  | { kicker: string }
  | { h1: string }
  | { h2: string }
  | { p: string; muted?: boolean }
  | { note: string }
  | { rows: Array<[string, string]> }
  | { list: string[]; numbered?: boolean }
  | { button: { href: string; label: string; secondary?: boolean } }
  | { code: string }
  | { link: { label: string; href: string } };

export type EmailInput = {
  subject: string;
  /** The line an inbox shows next to the subject. */
  preheader: string;
  blocks: Block[];
  /** Why the reader got this message. */
  footer: string;
  /** Security notices carry nothing clickable at all: whoever reads one is
   *  not necessarily the person who acted, and a link there is the exact
   *  shape an attacker would forge on the message a worried reader clicks. */
  noLinks?: boolean;
};

/** Outlook draws VML reliably and drops padding on links; everyone else gets the padded anchor. */
function button(href: string, label: string, secondary = false): string {
  const width = Math.min(520, Math.round(label.length * 8.6) + 60);
  const fill = secondary ? P.card : P.copper;
  const ink = secondary ? P.ink : "#ffffff";
  const cls = secondary ? "rx-btn2" : "rx-btn";
  return `<table role="presentation" cellpadding="0" cellspacing="0" class="rx-bt" style="margin:8px 0 22px"><tr><td class="${cls}" align="center" bgcolor="${fill}" style="border-radius:9px;background:${fill};${secondary ? `border:1px solid ${P.line};` : ""}">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(href)}" style="height:46px;v-text-anchor:middle;width:${width}px" arcsize="20%" ${secondary ? `strokecolor="${P.line}"` : 'stroke="f"'} fillcolor="${fill}"><w:anchorlock/><center style="color:${ink};font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:700">${escapeHtml(label)}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!--><a class="${cls}-a" href="${escapeHtml(href)}" style="display:inline-block;padding:13px 26px;${SANS}font-size:15px;line-height:20px;font-weight:700;color:${ink};text-decoration:none;border-radius:9px">${escapeHtml(label)}</a><!--<![endif]--></td></tr></table>`;
}

/** Renders one message as HTML and plain text from the same blocks, so the two cannot disagree. */
export function renderEmail(input: EmailInput): { subject: string; html: string; text: string } {
  const html: string[] = [];
  const text: string[] = [];
  const e = escapeHtml;
  for (const block of input.blocks) {
    if ("kicker" in block) {
      // The redaction bar from the Lock Pup mark, beside a copper label.
      html.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td class="rx-bar" bgcolor="${P.ink}" style="width:22px;height:6px;border-radius:3px;background:${P.ink};font-size:0;line-height:0">&nbsp;</td><td class="rx-kicker" style="padding-left:10px;${SANS}font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${P.copper}">${e(block.kicker)}</td></tr></table>`);
    } else if ("h1" in block) {
      html.push(`<h1 class="rx-ink rx-h1" style="margin:0 0 14px;${SANS}font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.5px;color:${P.ink}">${e(block.h1)}</h1>`);
      text.push(block.h1);
    } else if ("h2" in block) {
      html.push(`<h2 class="rx-ink" style="margin:28px 0 12px;${SANS}font-size:17px;line-height:24px;font-weight:700;color:${P.ink}">${e(block.h2)}</h2>`);
      text.push(block.h2);
    } else if ("p" in block) {
      html.push(`<p class="${block.muted ? "rx-muted" : "rx-body"}" style="margin:0 0 16px;${SANS}font-size:${block.muted ? 14 : 16}px;line-height:${block.muted ? 22 : 26}px;color:${block.muted ? P.muted : P.body}">${e(block.p)}</p>`);
      text.push(block.p);
    } else if ("note" in block) {
      html.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr><td class="rx-inset rx-body" bgcolor="${P.inset}" style="padding:15px 18px;background:${P.inset};border-left:3px solid ${P.copper};border-radius:4px;${SANS}font-size:14px;line-height:22px;color:${P.body}">${e(block.note)}</td></tr></table>`);
      text.push(block.note);
    } else if ("rows" in block) {
      html.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="rx-inset" bgcolor="${P.inset}" style="margin:6px 0 24px;background:${P.inset};border-radius:10px">` +
        block.rows.map(([key, value], i) => `<tr><td class="rx-muted rx-line" valign="top" style="padding:12px 18px;${i ? `border-top:1px solid ${P.line};` : ""}${SANS}font-size:14px;line-height:20px;color:${P.muted}">${e(key)}</td><td class="rx-ink rx-line" valign="top" align="right" style="padding:12px 18px;${i ? `border-top:1px solid ${P.line};` : ""}${SANS}font-size:14px;line-height:20px;font-weight:600;color:${P.ink};word-break:break-word">${e(value)}</td></tr>`).join("") + "</table>");
      text.push(block.rows.map(([key, value]) => `${key}: ${value}`).join("\n"));
    } else if ("list" in block) {
      html.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">` +
        block.list.map((item, i) => `<tr><td valign="top" class="rx-kicker" style="width:28px;padding:0 0 12px;${SANS}font-size:15px;line-height:23px;font-weight:700;color:${P.copper}">${block.numbered ? i + 1 : "&#10003;"}</td><td valign="top" class="rx-body" style="padding:0 0 12px;${SANS}font-size:15px;line-height:23px;color:${P.body}">${e(item)}</td></tr>`).join("") + "</table>");
      text.push(block.list.map((item, i) => `${block.numbered ? `${i + 1}.` : "-"} ${item}`).join("\n"));
    } else if ("button" in block) {
      html.push(button(block.button.href, block.button.label, block.button.secondary));
      text.push(`${block.button.label}: ${block.button.href}`);
    } else if ("code" in block) {
      html.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px"><tr><td class="rx-inset rx-ink" bgcolor="${P.inset}" style="padding:16px 24px;background:${P.inset};border:1px solid ${P.line};border-radius:10px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:30px;line-height:36px;letter-spacing:8px;font-weight:700;color:${P.ink}">${e(block.code)}</td></tr></table>`);
      text.push(block.code);
    } else if ("link" in block) {
      html.push(`<p class="rx-muted" style="margin:0 0 18px;${SANS}font-size:13px;line-height:20px;color:${P.muted}">${e(block.link.label)}<br><a class="rx-a" href="${e(block.link.href)}" style="color:${P.copper};word-break:break-all">${e(block.link.href)}</a></p>`);
      text.push(`${block.link.label}\n${block.link.href}`);
    }
  }

  const site = SITE_URL;
  const linkStyle = `color:${P.copper};text-decoration:none`;
  const logo = `<img src="${site}/outputs/redaxa-mark-128.png" width="34" height="34" alt="Redaxa" style="display:block;border:0;border-radius:9px">`;
  const brand = input.noLinks
    ? `<td valign="middle" style="padding-right:10px">${logo}</td><td valign="middle" class="rx-ink" style="${SANS}font-size:19px;line-height:22px;font-weight:700;letter-spacing:-0.3px;color:${P.ink}">Redaxa</td>`
    : `<td valign="middle" style="padding-right:10px"><a href="${site}/">${logo}</a></td><td valign="middle"><a class="rx-ink" href="${site}/" style="${SANS}font-size:19px;line-height:22px;font-weight:700;letter-spacing:-0.3px;color:${P.ink};text-decoration:none">Redaxa</a></td>`;
  const contact = input.noLinks
    ? `Questions? Reply to this email or write to ${e(SUPPORT_ADDRESS)}.`
    : `Questions? Reply to this email or write to <a class="rx-a" href="mailto:${SUPPORT_ADDRESS}" style="${linkStyle}">${SUPPORT_ADDRESS}</a>.`;
  const links = input.noLinks
    ? "Redaxa &middot; redaxa.getcertsprint.com"
    : `Redaxa &nbsp;&middot;&nbsp; <a class="rx-a" href="${site}/" style="${linkStyle}">redaxa.getcertsprint.com</a> &nbsp;&middot;&nbsp; <a class="rx-a" href="${site}/privacy.html" style="${linkStyle}">Privacy</a> &nbsp;&middot;&nbsp; <a class="rx-a" href="${site}/terms.html" style="${linkStyle}">Terms</a>`;

  const document = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(input.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
@media only screen and (max-width:620px){.rx-wrap{padding:16px 10px!important}.rx-card{padding:28px 22px 14px!important}.rx-h1{font-size:24px!important;line-height:30px!important}.rx-bt{width:100%!important}.rx-bt a{display:block!important}}
@media (prefers-color-scheme:dark){
.rx-page{background:#141218!important}.rx-cardbox{background:#1c1a21!important;border-color:#2e2b35!important}
.rx-ink{color:#f4f1ec!important}.rx-body{color:#ddd7e2!important}.rx-muted{color:#b8b1bf!important}
.rx-inset{background:#17151b!important;border-color:#2e2b35!important}.rx-line{border-color:#2e2b35!important}
.rx-kicker,.rx-a{color:#e8956a!important}.rx-bar{background:#f4f1ec!important}
.rx-btn{background:#e8956a!important}.rx-btn-a{color:#2a1407!important}.rx-btn2{background:#1c1a21!important;border-color:#4a4552!important}.rx-btn2-a{color:#f4f1ec!important}
}
[data-ogsc] .rx-ink{color:#f4f1ec!important}[data-ogsc] .rx-body{color:#ddd7e2!important}[data-ogsc] .rx-muted{color:#b8b1bf!important}[data-ogsc] .rx-kicker,[data-ogsc] .rx-a{color:#e8956a!important}
</style>
</head>
<body class="rx-page" style="margin:0;padding:0;background:${P.page}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${P.page}">${e(input.preheader)}${"&#8199;&#847;".repeat(60)}</div>
<table lang="en" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" class="rx-page" bgcolor="${P.page}" style="background:${P.page}"><tr><td align="center" class="rx-wrap" style="padding:32px 16px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 4px 18px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${brand}</tr></table></td></tr>
<tr><td class="rx-cardbox" bgcolor="${P.card}" style="background:${P.card};border:1px solid ${P.line};border-radius:16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="rx-card" style="padding:38px 40px 22px">${html.join("\n")}</td></tr></table></td></tr>
<tr><td class="rx-muted" style="padding:22px 6px 6px;${SANS}font-size:12px;line-height:19px;color:${P.muted}">${e(input.footer)}<br>${contact}</td></tr>
<tr><td class="rx-muted" style="padding:0 6px 26px;${SANS}font-size:12px;line-height:19px;color:${P.muted}">${links}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
  const footerText = `--\nRedaxa\n${input.footer}\nQuestions? Reply to this email or write to ${SUPPORT_ADDRESS}.\n${input.noLinks ? "redaxa.getcertsprint.com" : `${site}/  ·  Privacy: ${site}/privacy.html  ·  Terms: ${site}/terms.html`}`;
  return { subject: input.subject, html: document, text: `${text.join("\n\n")}\n\n${footerText}\n` };
}

export function subscriptionHtml(input: SubscriptionEmailInput): string { return subscriptionEmail(input).html; }
export function subscriptionText(input: SubscriptionEmailInput): string { return subscriptionEmail(input).text; }

function subscriptionEmail(input: SubscriptionEmailInput): { subject: string; html: string; text: string } {
  const { firstName, plan, interval, priceLabel, renewsOn, trialing, appUrl } = input;
  const intro = trialing
    ? "Your seven-day trial of Redaxa has started. Everything below is unlocked for the whole trial, and nothing is charged until it ends."
    : "Thanks for subscribing to Redaxa. Your account is active and everything below is unlocked, with no extra setup needed.";
  // "Renews on" is wrong during a trial: nothing has been paid yet, so the
  // date is when the first charge happens, not a renewal.
  const rows: Array<[string, string]> = [["Plan", planLabel(plan, interval)]];
  if (priceLabel) rows.push(["Price", priceLabel]);
  if (renewsOn) rows.push([trialing ? "First charge" : "Renews on", renewsOn]);
  return renderEmail({
    subject: subscriptionSubject(trialing),
    preheader: intro,
    footer: trialing ? "You are receiving this email because you started a Redaxa trial." : "You are receiving this email because you subscribed to Redaxa.",
    blocks: [
      { kicker: trialing ? "Trial started" : "Subscription active" },
      { h1: greet(trialing ? "Your trial is running" : "You're all set", firstName) },
      { p: intro },
      { rows },
      { h2: "What you've unlocked" },
      { list: [
        "Prompt checks on the web, in the Windows app and in the Chrome extension",
        "Local reviews of repositories for exposed secrets, in the Windows app",
        plan === "business" ? "Shared policies and an activity log for up to three seats" : "Every finding explained, with a redacted version ready to paste",
      ] },
      { button: { href: appUrl, label: "Open Redaxa" } },
      { p: trialing ? "You can cancel before the trial ends from your account settings, and nothing will be charged." : "You can cancel anytime from your account settings. Stripe sends the payment receipt separately.", muted: true },
    ],
  });
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
 * The one way out to Resend. `text` is not optional: HTML-only mail is a spam
 * signal in itself, and for a product sold on privacy a confirmation landing
 * in junk is the worst possible first impression.
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
      // reply_to, because every message invites a reply and the address it is
      // sent from is a noreply@: a promise the transport quietly breaks is
      // worse than not making it.
      body: JSON.stringify({ from, to, subject, html, text, reply_to: SUPPORT_ADDRESS }),
    });
    if (!response.ok) {
      console.error("redaxa mail failed", response.status);
      return false;
    }
    return true;
  } catch {
    console.error("redaxa mail request failed");
    return false;
  }
}

/** Tells the customer their subscription started. Never throws. The key,
 *  derived from the subscription, makes a duplicate webhook delivery that
 *  runs in parallel harmless: Resend sends one message per key. */
export async function sendSubscriptionEmail(input: SubscriptionEmailInput, idempotencyKey?: string): Promise<boolean> {
  const mail = subscriptionEmail(input);
  return send(input.to, mail.subject, mail.html, mail.text, idempotencyKey);
}

/**
 * The first message a new account gets from us, once, on confirmation or the
 * first confirmed sign-in. Deliberately no credentials and nothing to click
 * other than the app: a privacy product whose welcome trains people to click
 * authentication links out of an inbox teaches the habit that gets them phished.
 */
function welcomeEmail(firstName: string | null | undefined, appUrl: string): { subject: string; html: string; text: string } {
  const intro = "Redaxa helps you review prompts for sensitive details before sharing them with AI. Web and Windows checks are processed by Redaxa's scanner without storing the prompt text or forwarding it to an AI provider.";
  return renderEmail({
    subject: "Welcome to Redaxa",
    preheader: "Your account is confirmed. Here is how to catch keys, client names and personal data before they reach an AI chat.",
    footer: "You are receiving this email because you just confirmed a Redaxa account.",
    blocks: [
      { kicker: "Welcome" },
      { h1: greet("Your account is confirmed", firstName) },
      { p: intro },
      { h2: "Three minutes to set up" },
      { list: [
        "Install the browser extension or the desktop app",
        "Open ChatGPT, Claude, Gemini or Perplexity as you normally would",
        "Paste something with a key or an address in it and see what Redaxa flags before it sends",
      ], numbered: true },
      { button: { href: appUrl, label: "Open Redaxa" } },
      { p: "We will never ask you for a password or an API key by email.", muted: true },
    ],
  });
}
export function welcomeHtml(firstName: string | null | undefined, appUrl: string): string { return welcomeEmail(firstName, appUrl).html; }
export function welcomeText(firstName: string | null | undefined, appUrl: string): string { return welcomeEmail(firstName, appUrl).text; }

/**
 * The notice sent once a password has actually changed. No link and no code in
 * it, deliberately: whoever reads it is not necessarily the person who made
 * the change — that is why it exists — and a "this wasn't me" button would be
 * the exact shape an attacker would forge on the message a worried reader clicks.
 */
function passwordChangedEmail(firstName: string | null | undefined, when: string): { subject: string; html: string; text: string } {
  return renderEmail({
    subject: "Your Redaxa password was changed",
    preheader: `The password on your Redaxa account was changed on ${when}.`,
    footer: "This security notice is sent every time the password changes and cannot be turned off.",
    noLinks: true,
    blocks: [
      { kicker: "Security notice" },
      { h1: greet("Your password was changed", firstName) },
      { p: `The password on your Redaxa account was changed on ${when}. Other devices signed in to the account were signed out.` },
      { note: "If this was you, nothing else is needed. If it was not, reply to this message straight away: somebody else set that password." },
      { p: "We will never ask you for your password by email.", muted: true },
    ],
  });
}
export function passwordChangedHtml(firstName: string | null | undefined, when: string): string { return passwordChangedEmail(firstName, when).html; }
export function passwordChangedText(firstName: string | null | undefined, when: string): string { return passwordChangedEmail(firstName, when).text; }

/** Sends the notice. Never throws; the password has already changed. */
export async function sendPasswordChangedEmail(to: string, firstName: string | null | undefined): Promise<boolean> {
  const mail = passwordChangedEmail(firstName, new Date().toUTCString());
  return send(to, mail.subject, mail.html, mail.text);
}

/** Sends the welcome. Never throws; the caller has already succeeded. */
export async function sendWelcomeEmail(to: string, firstName: string | null | undefined, appUrl: string, userId?: string): Promise<boolean> {
  const mail = welcomeEmail(firstName, appUrl);
  return send(to, mail.subject, mail.html, mail.text, userId ? `redaxa-welcome/${userId}` : undefined);
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
  const kind = trialing ? "trial" : "subscription";
  const mail = renderEmail({
    subject: `New Redaxa ${kind} — ${label}`,
    preheader: `Someone just started a Redaxa ${kind}: ${label}.`,
    footer: "Internal notice for the Redaxa team. Stripe holds the payment record.",
    blocks: [
      { kicker: `New ${kind}` },
      { h1: `New Redaxa ${kind}` },
      { rows: [["Plan", label], ["Account", customerEmail || "(unknown address)"]] },
      { p: "Stripe has the details; this is only the heads-up.", muted: true },
    ],
  });
  return send(OWNER_INBOX, mail.subject, mail.html, mail.text, idempotencyKey);
}
