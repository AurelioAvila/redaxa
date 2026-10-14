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

// The email design kit's layout (my-apps/email-design-kit/_base/layout.html) in Redaxa's own
// palette: Paper with the copper accent, the site's default, and Ink & Copper when the reader's mail
// app is dark. Contrast on the card: ink 16.9:1, muted 6.9:1, white on copper 6.4:1; dark: ink
// 15.2:1, muted 8.0:1, button ink on copper 7.4:1.
const P = { page: "#f7f6f2", card: "#ffffff", panel: "#f2f0ea", line: "#e3dfd5", ink: "#1b1724", muted: "#5a5466", copper: "#a3471d", copperInk: "#ffffff" };
const D = { page: "#141218", card: "#1c1a21", panel: "#24212a", line: "#2e2b35", ink: "#f4f1ec", muted: "#b8b1bf", copper: "#e8956a", copperInk: "#2a1407" };
const SANS = "font-family:Inter,'Segoe UI',Bahnschrift,Helvetica,Arial,sans-serif;";
const MONO = "font-family:Consolas,'SFMono-Regular',Menlo,'Courier New',monospace;";

/** A content block. Strings are plain text; the renderer escapes them. */
export type Block =
  | { kicker: string }
  | { h1: string }
  | { h2: string }
  | { p: string; muted?: boolean }
  | { note: string; title?: string }
  | { rows: Array<[string, string]> }
  | { list: string[]; numbered?: boolean }
  | { button: { href: string; label: string; secondary?: boolean } }
  | { code: string }
  | { link: { label: string; href: string } }
  | { security: [string, string] };

export type EmailInput = {
  subject: string;
  /** The line an inbox shows next to the subject. */
  preheader: string;
  blocks: Block[];
  /** Why the reader got this message. */
  footer: string;
  /** The help block at the bottom of the card: a question the reader may have, and what to send. */
  help?: [string, string];
  /** Security notices carry nothing clickable at all: whoever reads one is
   *  not necessarily the person who acted, and a link there is the exact
   *  shape an attacker would forge on the message a worried reader clicks. */
  noLinks?: boolean;
};

/** The kit's bulletproof button: VML for Outlook's Word engine, a padded link everywhere else. */
function button(href: string, label: string): string {
  const width = Math.min(520, Math.round(label.length * 9) + 64);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn" style="margin:4px 0 24px;"><tr><td class="btn-cell" align="center" bgcolor="${P.copper}" style="border-radius:10px;background:${P.copper};">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(href)}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="21%" stroke="f" fillcolor="${P.copper}"><w:anchorlock/><center style="color:${P.copperInk};font-family:Arial,sans-serif;font-size:16px;font-weight:700;">${escapeHtml(label)}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!--><a class="btn-a" href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;${SANS}font-size:16px;line-height:20px;font-weight:700;color:${P.copperInk};text-decoration:none;border-radius:10px;background:${P.copper};">${escapeHtml(label)}</a><!--<![endif]--></td></tr></table>`;
}

/** Renders one message as HTML and plain text from the same blocks, so the two cannot disagree. */
export function renderEmail(input: EmailInput): { subject: string; html: string; text: string } {
  const html: string[] = [];
  const text: string[] = [];
  const e = escapeHtml;
  const panel = (inner: string, margin = "0 0 24px"): string =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" bgcolor="${P.panel}" style="background:${P.panel};border-radius:10px;margin:${margin};"><tr><td style="padding:16px 18px;">${inner}</td></tr></table>`;
  for (const block of input.blocks) {
    if ("kicker" in block) {
      html.push(`<p class="eyebrow" style="margin:0 0 10px;${SANS}font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${P.copper};">${e(block.kicker)}</p>`);
    } else if ("h1" in block) {
      html.push(`<h1 class="h1 ink" style="margin:0 0 14px;${SANS}font-size:26px;line-height:32px;font-weight:700;letter-spacing:-0.4px;color:${P.ink};">${e(block.h1)}</h1>`);
      text.push(block.h1);
    } else if ("h2" in block) {
      html.push(`<p class="muted" style="margin:6px 0 10px;${SANS}font-size:12px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${P.muted};">${e(block.h2)}</p>`);
      text.push(block.h2);
    } else if ("p" in block) {
      html.push(block.muted
        ? `<p class="muted" style="margin:0 0 20px;${SANS}font-size:13px;line-height:19px;color:${P.muted};">${e(block.p)}</p>`
        : `<p class="ink" style="margin:0 0 22px;${SANS}font-size:16px;line-height:25px;color:${P.ink};">${e(block.p)}</p>`);
      text.push(block.p);
    } else if ("note" in block) {
      html.push(panel((block.title ? `<p class="ink" style="margin:0 0 8px;${SANS}font-size:15px;line-height:22px;font-weight:700;color:${P.ink};">${e(block.title)}</p>` : "") +
        `<p class="ink" style="margin:0;${SANS}font-size:14px;line-height:21px;color:${P.ink};">${e(block.note)}</p>`));
      text.push(block.title ? `${block.title}\n${block.note}` : block.note);
    } else if ("rows" in block) {
      const last = block.rows.length - 1;
      html.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" bgcolor="${P.panel}" style="background:${P.panel};border-radius:10px;margin:0 0 24px;"><tr><td style="padding:6px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
        block.rows.map(([key, value], i) => {
          const rule = i < last ? `border-bottom:1px solid ${P.line};` : "";
          return `<tr><td class="muted rule" width="38%" valign="top" style="padding:10px 12px 10px 0;${rule}${SANS}font-size:13px;line-height:20px;color:${P.muted};">${e(key)}</td><td class="ink rule" valign="top" style="padding:10px 0;${rule}${SANS}font-size:15px;line-height:20px;font-weight:700;color:${P.ink};word-break:break-word;">${e(value)}</td></tr>`;
        }).join("") + "</table></td></tr></table>");
      text.push(block.rows.map(([key, value]) => `${key}: ${value}`).join("\n"));
    } else if ("list" in block) {
      html.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">` +
        block.list.map((item, i) => `<tr><td width="24" valign="top" style="padding:1px 12px 12px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="btn-cell" align="center" width="24" height="24" bgcolor="${P.copper}" style="width:24px;height:24px;border-radius:12px;background:${P.copper};font-family:Arial,sans-serif;font-size:12px;line-height:24px;font-weight:700;color:${P.copperInk};">${block.numbered ? i + 1 : "&#10003;"}</td></tr></table></td><td class="ink" valign="top" style="padding:0 0 12px;${SANS}font-size:15px;line-height:22px;color:${P.ink};">${e(item)}</td></tr>`).join("") + "</table>");
      text.push(block.list.map((item, i) => `${block.numbered ? `${i + 1}.` : "-"} ${item}`).join("\n"));
    } else if ("button" in block) {
      html.push(button(block.button.href, block.button.label));
      text.push(`${block.button.label}: ${block.button.href}`);
    } else if ("code" in block) {
      html.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" bgcolor="${P.panel}" style="background:${P.panel};border-radius:10px;margin:0 0 20px;"><tr><td align="center" class="ink otp" style="padding:20px 16px;${MONO}font-size:28px;line-height:36px;font-weight:700;letter-spacing:6px;color:${P.ink};">${e(block.code)}</td></tr></table>`);
      text.push(block.code);
    } else if ("link" in block) {
      html.push(`<p class="muted" style="margin:-8px 0 24px;${SANS}font-size:13px;line-height:19px;color:${P.muted};word-break:break-all;">${e(block.link.label)}<br><a class="link" href="${e(block.link.href)}" style="color:${P.copper};">${e(block.link.href)}</a></p>`);
      text.push(`${block.link.label}\n${block.link.href}`);
    } else if ("security" in block) {
      html.push(panel(`<p class="ink" style="margin:0 0 8px;${SANS}font-size:15px;line-height:22px;color:${P.ink};"><strong>If this was you:</strong> ${e(block.security[0])}</p><p class="ink" style="margin:0;${SANS}font-size:15px;line-height:22px;color:${P.ink};"><strong>If it was not:</strong> ${e(block.security[1])}</p>`));
      text.push(`If this was you: ${block.security[0]}\nIf it was not: ${block.security[1]}`);
    }
  }

  const site = SITE_URL;
  const linkStyle = `color:${P.muted};`;
  const logo = `<img src="${site}/outputs/redaxa-mark-128.png" width="40" height="40" alt="Redaxa" style="display:block;width:40px;height:40px;border-radius:10px;">`;
  const brand = input.noLinks
    ? `<td width="40" valign="middle" style="padding:0 12px 0 0;">${logo}</td><td valign="middle" class="ink" style="${SANS}font-size:19px;line-height:24px;font-weight:700;letter-spacing:-0.2px;color:${P.ink};">Redaxa</td>`
    : `<td width="40" valign="middle" style="padding:0 12px 0 0;"><a href="${site}/" style="text-decoration:none;">${logo}</a></td><td valign="middle" style="${SANS}font-size:19px;line-height:24px;font-weight:700;letter-spacing:-0.2px;"><a class="ink" href="${site}/" style="color:${P.ink};text-decoration:none;">Redaxa</a></td>`;
  const [helpTitle, helpText] = input.help ?? ["Something not as described?", "Reply to this email with what you were doing and what you saw."];
  const write = /^Reply/.test(helpText) ? "Or write to" : "Write to";
  const support = input.noLinks ? SUPPORT_ADDRESS : `<a class="link" href="mailto:${SUPPORT_ADDRESS}" style="color:${P.copper};">${SUPPORT_ADDRESS}</a>`;
  const links = input.noLinks
    ? "Redaxa &middot; redaxa.getcertsprint.com"
    : `Redaxa &middot; <a class="link" href="${site}/" style="${linkStyle}">redaxa.getcertsprint.com</a> &middot; <a class="link" href="${site}/privacy.html" style="${linkStyle}">Privacy</a> &middot; <a class="link" href="${site}/terms.html" style="${linkStyle}">Terms</a>`;
  const dark = `.bg{background:${D.page}!important}.card{background:${D.card}!important;border-color:${D.line}!important}.panel{background:${D.panel}!important}.ink{color:${D.ink}!important}.muted{color:${D.muted}!important}.rule{border-color:${D.line}!important}.link,.eyebrow{color:${D.copper}!important}.btn-cell{background:${D.copper}!important}.btn-a{color:${D.copperInk}!important;background:${D.copper}!important}.bar{background:${D.copper}!important}`;
  const ogsc = dark.replace(/(^|\}|,)\./g, "$1[data-ogsc] .");

  const document = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<title>${e(input.subject)}</title>
<style>
  body,table,td,p,a,li{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table,td{mso-table-lspace:0;mso-table-rspace:0;border-collapse:collapse}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;display:block}
  body{margin:0;padding:0;width:100%!important}
  a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
  @media only screen and (max-width:620px){
    .wrap{padding:16px 10px!important}
    .card-pad{padding:26px 20px 8px!important}
    .head{padding:18px 20px!important}
    .help{padding:18px 20px!important}
    .h1{font-size:24px!important;line-height:30px!important}
    .btn,.btn td,.btn a{width:100%!important;display:block!important;text-align:center!important;box-sizing:border-box!important}
    .otp{font-size:22px!important;letter-spacing:4px!important}
  }
  @media (prefers-color-scheme:dark){${dark}}
  ${ogsc}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${P.page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${P.page};">${e(input.preheader)}${"&#8199;&#847;".repeat(60)}</div>
<table lang="en" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${P.page}" style="background:${P.page};">
<tr><td align="center" class="wrap" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:600px;margin:0 auto;">
  <tr><td class="card" bgcolor="${P.card}" style="background:${P.card};border:1px solid ${P.line};border-radius:14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="bar" style="height:5px;font-size:0;line-height:0;background:${P.copper};border-radius:14px 14px 0 0;">&nbsp;</td></tr>
      <tr><td class="head rule" style="padding:20px 32px;border-bottom:1px solid ${P.line};"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${brand}</tr></table></td></tr>
      <tr><td class="card-pad" style="padding:32px 32px 8px;">
${html.join("\n")}
      </td></tr>
      <tr><td class="panel help" bgcolor="${P.panel}" style="background:${P.panel};padding:18px 32px;border-radius:0 0 14px 14px;">
        <p class="ink" style="margin:0 0 4px;${SANS}font-size:14px;line-height:21px;font-weight:700;color:${P.ink};">${e(helpTitle)}</p>
        <p class="muted" style="margin:0;${SANS}font-size:14px;line-height:21px;color:${P.muted};">${e(helpText)} ${write} ${support}. Never send a password or an API key by email.</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:20px 8px 0;">
    <p class="muted" style="margin:0 0 6px;${SANS}font-size:12px;line-height:18px;color:${P.muted};">${e(input.footer)}</p>
    <p class="muted" style="margin:0;${SANS}font-size:12px;line-height:18px;color:${P.muted};">${links}</p>
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
  const footerText = `${helpTitle}\n${helpText} ${write} ${SUPPORT_ADDRESS}. Never send a password or an API key by email.\n\n--\n${input.footer}\n${input.noLinks ? "Redaxa · redaxa.getcertsprint.com" : `Redaxa · ${site}/ · Privacy: ${site}/privacy.html · Terms: ${site}/terms.html`}`;
  return { subject: input.subject, html: document, text: `${text.join("\n\n")}\n\n${footerText}\n` };
}

export function subscriptionHtml(input: SubscriptionEmailInput): string { return subscriptionEmail(input).html; }
export function subscriptionText(input: SubscriptionEmailInput): string { return subscriptionEmail(input).text; }

function subscriptionEmail(input: SubscriptionEmailInput): { subject: string; html: string; text: string } {
  const { firstName, plan, interval, priceLabel, renewsOn, trialing, appUrl } = input;
  const business = plan === "business";
  const tier = business ? "Business" : "Pro";
  const intro = trialing
    ? `Your seven-day Redaxa trial has started. Every ${tier} feature is on for the whole trial, and nothing is charged until it ends.`
    : `Your Redaxa ${tier} subscription is active on this account, on the web, in the Windows app and in the Chrome extension. There is nothing else to set up.`;
  // "Renews on" is wrong during a trial: nothing has been paid yet, so the
  // date is when the first charge happens, not a renewal.
  const rows: Array<[string, string]> = [["Plan", planLabel(plan, interval)]];
  if (priceLabel) rows.push(["Price", priceLabel]);
  if (renewsOn) rows.push([trialing ? "First charge" : "Renews on", renewsOn]);
  const firstSteps = business
    ? ["Add the client and project names your team must never paste into a chat under Protected terms. They apply to every member.",
      "Choose a policy per category (warn, redact or block sending in the Chrome extension) so everyone follows the same rule.",
      "Invite your colleagues from your account. Admins see metadata-only activity, never the prompt text, and can export it as CSV."]
    : ["Add your client and project names under Protected terms, so Redaxa flags them in every prompt you check.",
      "Check a repository: 60 a day on the web, or a local review with Git history in the Windows app.",
      "Install the Chrome extension. It checks what you are about to send on ChatGPT, Claude, Gemini and Perplexity."];
  return renderEmail({
    subject: subscriptionSubject(trialing),
    preheader: trialing ? `Nothing is charged before ${renewsOn ?? "the trial ends"}. Three things to try first.` : `Plan ${planLabel(plan, interval)}${renewsOn ? `, renews on ${renewsOn}` : ""}. Three things to try first.`,
    footer: trialing ? "You received this email because you started a Redaxa trial with this address." : "You received this email because you subscribed to Redaxa with this address.",
    help: ["Billing question, or something not working?", "Reply to this email from the address on the account."],
    blocks: [
      { kicker: trialing ? "Trial started" : "Subscription active" },
      { h1: greet(trialing ? "Your trial is running" : "You're all set", firstName) },
      { p: intro },
      { rows },
      { button: { href: appUrl, label: "Open Redaxa" } },
      { h2: "Three things to try first" },
      { list: firstSteps, numbered: true },
      { note: trialing
          ? `Cancel before ${renewsOn ?? "the trial ends"} from Your account, under Subscription & invoices, and nothing is charged. Stripe emails a receipt when the first payment is taken.`
          : "Change or cancel the plan from Your account, under Subscription & invoices. Stripe sends the payment receipt separately.",
        title: "Managing the plan" },
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
    footer: "You received this email because you just confirmed a Redaxa account with this address. It is sent once.",
    help: ["Not sure where to start?", "Reply with the AI tools you use most and we will point you to the right setup."],
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
      { note: "Free checks in the Chrome extension run in your browser and have no daily limit. On the web and in the Windows app the free plan includes 5 prompt checks a day, plus 3 public repository checks a day on the web.", title: "What the free plan includes" },
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
    preheader: `Changed on ${when}. Every device that was signed in has been signed out.`,
    footer: "This security notice is sent every time the password changes and cannot be turned off.",
    help: ["Did not change it?", "Reply to this message straight away from this address."],
    noLinks: true,
    blocks: [
      { kicker: "Security notice" },
      { h1: greet("Your password was changed", firstName) },
      { p: `The password on your Redaxa account was changed on ${when}. Every device that was signed in to the account has been signed out.` },
      { security: ["nothing else is needed. Sign in again on the web, in the Windows app and in the extension with the new password.", "reply to this message straight away. Somebody else set that password, and we will help you take the account back."] },
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
