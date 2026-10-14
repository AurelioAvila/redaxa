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

// Redaxa emails, after the revised design kit: the brand runs from top to bottom. An Ink hero (the
// colour of the Lock Pup's face, Redaxa's "Ink & Copper") carries the mark, the kind of message, the
// title and the intro; a line of redaction bars under it is the signature; the body alternates cream
// and copper-tinted Paper sections; an optional copper "moment" band states the number that matters;
// the footer closes on Ink with the bars again. Contrast: white on ink 17:1, ink on cream 16.9:1,
// muted 6.9:1, white on copper 6.4:1.
const P = { page: "#ece3d6", card: "#fffcf7", alt: "#f7efe4", panel: "#f1e6d7", line: "#e6d8c5", ink: "#1b1724", muted: "#5a5466", copper: "#a3471d", copperInk: "#ffffff", night: "#1b1724", nightHi: "#2c2735", chrome: "#bdb5c4", glow: "#e8956a" };
const D = { page: "#0f0d12", card: "#1c1a21", alt: "#221f28", panel: "#2a2631", line: "#353140", ink: "#f4f1ec", muted: "#b8b1bf", copper: "#e8956a" };
const SANS = "font-family:Inter,'Segoe UI',Bahnschrift,Helvetica,Arial,sans-serif;";
const MONO = "font-family:Consolas,'SFMono-Regular',Menlo,'Courier New',monospace;";

export type EmailKind = "account" | "security" | "billing" | "welcome" | "internal";
const KIND_LABEL: Record<EmailKind, string> = { account: "Account", security: "Security notice", billing: "Billing", welcome: "Welcome", internal: "Team notice" };

/** The signature: redaction bars, the wink of the Lock Pup mark, as a line of blacked-out text. */
function redactionBars(widths: number[], colours: string[], height = 8): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${widths.map((width, i) =>
    `<td style="padding:0 ${i === widths.length - 1 ? 0 : 7}px 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="${width}" height="${height}" bgcolor="${colours[i % colours.length]}" style="width:${width}px;height:${height}px;font-size:0;line-height:0;border-radius:${height / 2}px;background:${colours[i % colours.length]};">&nbsp;</td></tr></table></td>`).join("")}</tr></table>`;
}

/** A content block. Strings are plain text; the renderer escapes them. The first kicker, h1 and p
 *  open the message in the hero; the rest fill the sections below it. */
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
  | { security: [string, string] }
  | { moment: { kicker: string; big: string; text: string } };

export type EmailInput = {
  subject: string;
  /** Sets the label in the hero. */
  kind?: EmailKind;
  /** The line an inbox shows next to the subject. */
  preheader: string;
  blocks: Block[];
  /** Why the reader got this message. */
  footer: string;
  /** The help block at the bottom: a question the reader may have, and what to send. */
  help?: [string, string];
  /** Security notices carry nothing clickable at all: whoever reads one is
   *  not necessarily the person who acted, and a link there is the exact
   *  shape an attacker would forge on the message a worried reader clicks. */
  noLinks?: boolean;
};

/** The kit's bulletproof button: VML for Outlook's Word engine, a padded link everywhere else. */
function button(href: string, label: string): string {
  const width = Math.min(520, Math.round(label.length * 9) + 64);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn" style="margin:6px 0 24px;"><tr><td class="btn-cell" align="center" bgcolor="${P.copper}" style="border-radius:10px;background:${P.copper};">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(href)}" style="height:50px;v-text-anchor:middle;width:${width}px;" arcsize="20%" stroke="f" fillcolor="${P.copper}"><w:anchorlock/><center style="color:${P.copperInk};font-family:Arial,sans-serif;font-size:16px;font-weight:700;">${escapeHtml(label)}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!--><a class="btn-a" href="${escapeHtml(href)}" style="display:inline-block;padding:15px 30px;${SANS}font-size:16px;line-height:20px;font-weight:700;color:${P.copperInk};text-decoration:none;border-radius:10px;background:${P.copper};">${escapeHtml(label)}</a><!--<![endif]--></td></tr></table>`;
}

/** Renders one message as HTML and plain text from the same blocks, so the two cannot disagree. */
export function renderEmail(input: EmailInput): { subject: string; html: string; text: string } {
  const e = escapeHtml;
  const hero: { kicker?: string; h1?: string; p?: string } = {};
  type Section = string[] | { moment: { kicker: string; big: string; text: string } };
  const sections: Section[] = [[]];
  const text: string[] = [];
  const html = (): string[] => {
    const last = sections[sections.length - 1];
    if (Array.isArray(last)) return last;
    const fresh: string[] = [];
    sections.push(fresh);
    return fresh;
  };
  const panel = (inner: string): string =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" bgcolor="${P.panel}" style="background:${P.panel};border-radius:10px;margin:0 0 24px;"><tr><td style="padding:17px 19px;">${inner}</td></tr></table>`;
  for (const block of input.blocks) {
    if ("kicker" in block) { hero.kicker = block.kicker; }
    else if ("h1" in block) { hero.h1 = block.h1; text.push(block.h1); }
    else if ("p" in block && !block.muted && hero.p === undefined && html().length === 0) { hero.p = block.p; text.push(block.p); }
    else if ("h2" in block) {
      if (html().length) sections.push([]);
      html().push(`<p class="eyebrow" style="margin:0 0 16px;${SANS}font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${P.copper};">${e(block.h2)}</p>`);
      text.push(block.h2);
    } else if ("p" in block) {
      html().push(block.muted
        ? `<p class="muted" style="margin:0 0 20px;${SANS}font-size:13px;line-height:19px;color:${P.muted};">${e(block.p)}</p>`
        : `<p class="ink" style="margin:0 0 22px;${SANS}font-size:16px;line-height:25px;color:${P.ink};">${e(block.p)}</p>`);
      text.push(block.p);
    } else if ("note" in block) {
      html().push(panel((block.title ? `<p class="ink" style="margin:0 0 8px;${SANS}font-size:15px;line-height:22px;font-weight:700;color:${P.ink};">${e(block.title)}</p>` : "") +
        `<p class="ink" style="margin:0;${SANS}font-size:14px;line-height:21px;color:${P.ink};">${e(block.note)}</p>`));
      text.push(block.title ? `${block.title}\n${block.note}` : block.note);
    } else if ("rows" in block) {
      const last = block.rows.length - 1;
      html().push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" bgcolor="${P.panel}" style="background:${P.panel};border-left:4px solid ${P.copper};border-radius:6px;margin:0 0 24px;"><tr><td style="padding:4px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
        block.rows.map(([key, value], i) => {
          const rule = i < last ? `border-bottom:1px solid ${P.line};` : "";
          return `<tr><td class="muted rule" width="38%" valign="top" style="padding:11px 12px 11px 0;${rule}${SANS}font-size:13px;line-height:20px;color:${P.muted};">${e(key)}</td><td class="ink rule" valign="top" style="padding:11px 0;${rule}${SANS}font-size:15px;line-height:20px;font-weight:700;color:${P.ink};word-break:break-word;">${e(value)}</td></tr>`;
        }).join("") + "</table></td></tr></table>");
      text.push(block.rows.map(([key, value]) => `${key}: ${value}`).join("\n"));
    } else if ("list" in block) {
      html().push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">` +
        block.list.map((item, i) => `<tr><td width="30" valign="top" style="padding:0 14px 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="btn-cell" align="center" width="30" height="30" bgcolor="${P.copper}" style="width:30px;height:30px;border-radius:15px;background:${P.copper};font-family:Arial,sans-serif;font-size:14px;line-height:30px;font-weight:700;color:${P.copperInk};">${block.numbered ? i + 1 : "&#10003;"}</td></tr></table></td><td class="ink" valign="top" style="padding:4px 0 16px;${SANS}font-size:15px;line-height:22px;color:${P.ink};">${e(item)}</td></tr>`).join("") + "</table>");
      text.push(block.list.map((item, i) => `${block.numbered ? `${i + 1}.` : "-"} ${item}`).join("\n"));
    } else if ("button" in block) {
      html().push(button(block.button.href, block.button.label));
      text.push(`${block.button.label}: ${block.button.href}`);
    } else if ("code" in block) {
      html().push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${P.night}" style="background:${P.night};border-radius:12px;margin:0 0 22px;"><tr><td align="center" style="padding:18px 16px 4px;">${redactionBars([30, 14, 44, 18], ["#4a4552", P.glow, "#4a4552", "#4a4552"], 6)}</td></tr><tr><td align="center" class="otp" style="padding:12px 16px 20px;${MONO}font-size:32px;line-height:38px;font-weight:700;letter-spacing:8px;color:#ffffff;">${e(block.code)}</td></tr></table>`);
      text.push(block.code);
    } else if ("link" in block) {
      html().push(`<p class="muted" style="margin:-10px 0 24px;${SANS}font-size:13px;line-height:19px;color:${P.muted};word-break:break-all;">${e(block.link.label)}<br><a class="link" href="${e(block.link.href)}" style="color:${P.copper};">${e(block.link.href)}</a></p>`);
      text.push(`${block.link.label}\n${block.link.href}`);
    } else if ("security" in block) {
      html().push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" bgcolor="${P.panel}" style="background:${P.panel};border-left:4px solid ${P.ink};border-radius:6px;margin:0 0 24px;"><tr><td style="padding:16px 18px;"><p class="ink" style="margin:0 0 8px;${SANS}font-size:15px;line-height:22px;color:${P.ink};"><strong>If this was you:</strong> ${e(block.security[0])}</p><p class="ink" style="margin:0;${SANS}font-size:15px;line-height:22px;color:${P.ink};"><strong>If it was not:</strong> ${e(block.security[1])}</p></td></tr></table>`);
      text.push(`If this was you: ${block.security[0]}\nIf it was not: ${block.security[1]}`);
    } else if ("moment" in block) {
      sections.push({ moment: block.moment });
      text.push(`${block.moment.kicker}: ${block.moment.big}. ${block.moment.text}`);
    }
  }

  const site = SITE_URL;
  const kind = input.kind ?? "account";
  const logo = `<img src="${site}/outputs/redaxa-mark-128.png" width="56" height="56" alt="Redaxa" style="display:block;width:56px;height:56px;border-radius:14px;">`;
  const smallLogo = `<img src="${site}/outputs/redaxa-mark-128.png" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border-radius:7px;">`;
  const brand = input.noLinks
    ? `<td width="56" valign="middle" style="padding:0 14px 0 0;">${logo}</td><td valign="middle" style="${SANS}font-size:15px;line-height:20px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#f4f1ec;">Redaxa</td>`
    : `<td width="56" valign="middle" style="padding:0 14px 0 0;"><a href="${site}/" style="text-decoration:none;">${logo}</a></td><td valign="middle" style="${SANS}font-size:15px;line-height:20px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;"><a href="${site}/" style="color:#f4f1ec;text-decoration:none;">Redaxa</a></td>`;
  const [helpTitle, helpText] = input.help ?? ["Something not as described?", "Reply to this email with what you were doing and what you saw."];
  const write = /^Reply/.test(helpText) ? "Or write to" : "Write to";
  const support = input.noLinks ? SUPPORT_ADDRESS : `<a class="link" href="mailto:${SUPPORT_ADDRESS}" style="color:${P.copper};">${SUPPORT_ADDRESS}</a>`;
  const footLink = "color:#f0c9ad;";
  const links = input.noLinks
    ? "redaxa.getcertsprint.com"
    : `<a href="${site}/" style="${footLink}">redaxa.getcertsprint.com</a> &middot; <a href="${site}/privacy.html" style="${footLink}">Privacy</a> &middot; <a href="${site}/terms.html" style="${footLink}">Terms</a> &middot; <a href="mailto:${SUPPORT_ADDRESS}" style="${footLink}">Support</a>`;
  let alternate = false;
  const body = sections.map(section => {
    if (!Array.isArray(section)) {
      alternate = false;
      return `<tr><td class="pad" bgcolor="${P.copper}" style="background:${P.copper};background-image:linear-gradient(120deg,#8c3a16 0%,#b4562b 100%);padding:24px 36px;"><p style="margin:0 0 6px;${SANS}font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:#ffe2cf;">${e(section.moment.kicker)}</p><p class="big" style="margin:0 0 6px;${SANS}font-size:32px;line-height:38px;font-weight:700;letter-spacing:-0.6px;color:#ffffff;">${e(section.moment.big)}</p><p style="margin:0;${SANS}font-size:14px;line-height:21px;color:#fde9dc;">${e(section.moment.text)}</p></td></tr>`;
    }
    if (!section.length) return "";
    const tone = alternate ? { cls: "alt", bg: P.alt } : { cls: "card", bg: P.card };
    alternate = !alternate;
    return `<tr><td class="${tone.cls} pad" bgcolor="${tone.bg}" style="background:${tone.bg};padding:30px 36px 8px;">\n${section.join("\n")}\n</td></tr>`;
  }).join("\n");
  const dark = `.bg{background:${D.page}!important}.card{background:${D.card}!important}.alt{background:${D.alt}!important}.panel{background:${D.panel}!important}.ink{color:${D.ink}!important}.muted{color:${D.muted}!important}.rule{border-color:${D.line}!important}.link,.eyebrow{color:${D.copper}!important}`;
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
    .wrap{padding:10px 6px!important}.pad{padding-left:20px!important;padding-right:20px!important}
    .hero{padding-top:24px!important;padding-bottom:22px!important}.h1{font-size:26px!important;line-height:32px!important}
    .big{font-size:28px!important;line-height:34px!important}.otp{font-size:24px!important;letter-spacing:5px!important}
    .btn,.btn td,.btn a{width:100%!important;display:block!important;text-align:center!important;box-sizing:border-box!important}
    .hide-sm{display:none!important}
  }
  @media (prefers-color-scheme:dark){${dark}}
  ${ogsc}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${P.page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${P.page};">${e(input.preheader)}${"&#8199;&#847;".repeat(60)}</div>
<table lang="en" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${P.page}" style="background:${P.page};">
<tr><td align="center" class="wrap" style="padding:28px 14px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:600px;margin:0 auto;">
  <tr><td bgcolor="${P.copper}" style="height:6px;font-size:0;line-height:0;background:${P.copper};border-radius:16px 16px 0 0;">&nbsp;</td></tr>
  <tr><td class="hero pad" bgcolor="${P.night}" style="background:${P.night};background-image:linear-gradient(160deg,#141118 0%,#2c2537 100%);padding:28px 36px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${brand}
      <td class="hide-sm" align="right" valign="middle" style="${SANS}font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${P.glow};">${e(KIND_LABEL[kind])}</td>
    </tr></table>
    ${hero.kicker ? `<p style="margin:24px 0 8px;${SANS}font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${P.glow};">${e(hero.kicker)}</p>` : ""}
    <h1 class="h1" style="margin:${hero.kicker ? 0 : 22}px 0 10px;${SANS}font-size:30px;line-height:36px;font-weight:700;letter-spacing:-0.6px;color:#ffffff;">${e(hero.h1 ?? input.subject)}</h1>
    ${hero.p ? `<p style="margin:0 0 20px;${SANS}font-size:16px;line-height:25px;color:#e6e0ea;">${e(hero.p)}</p>` : `<div style="height:8px;font-size:0;line-height:0;">&nbsp;</div>`}
    ${redactionBars([46, 22, 70, 16, 34], ["#4a4552", "#4a4552", P.glow, "#4a4552", "#4a4552"])}
  </td></tr>
  <tr><td bgcolor="#c46a3e" style="height:4px;font-size:0;line-height:0;background:#c46a3e;">&nbsp;</td></tr>
  <tr><td bgcolor="#e2a582" style="height:4px;font-size:0;line-height:0;background:#e2a582;">&nbsp;</td></tr>
  ${body}
  <tr><td class="alt pad" bgcolor="${P.alt}" style="background:${P.alt};padding:8px 36px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" bgcolor="${P.panel}" style="background:${P.panel};border-left:4px solid ${P.copper};border-radius:6px;"><tr><td style="padding:16px 18px;">
      <p class="ink" style="margin:0 0 4px;${SANS}font-size:14px;line-height:21px;font-weight:700;color:${P.ink};">${e(helpTitle)}</p>
      <p class="muted" style="margin:0;${SANS}font-size:14px;line-height:21px;color:${P.muted};">${e(helpText)} ${write} ${support}. Never send a password or an API key by email.</p>
    </td></tr></table>
  </td></tr>
  <tr><td class="pad" bgcolor="${P.night}" style="background:${P.night};padding:24px 36px 26px;border-radius:0 0 16px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding:0 10px 0 0;">${smallLogo}</td><td valign="middle" style="${SANS}font-size:14px;line-height:18px;font-weight:700;color:#ffffff;">Redaxa<br><span style="font-size:12px;font-weight:400;color:${P.chrome};">Share the work. Keep the secrets.</span></td></tr></table></td>
      <td class="hide-sm" align="right" valign="middle">${redactionBars([22, 12, 30], ["#4a4552", P.glow, "#4a4552"], 6)}</td>
    </tr></table>
    <p style="margin:16px 0 6px;${SANS}font-size:12px;line-height:18px;color:${P.chrome};">${e(input.footer)}</p>
    <p style="margin:0;${SANS}font-size:12px;line-height:18px;color:${P.chrome};">${links}</p>
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
    kind: "billing",
    preheader: trialing ? `Nothing is charged before ${renewsOn ?? "the trial ends"}. Three things to try first.` : `Plan ${planLabel(plan, interval)}${renewsOn ? `, renews on ${renewsOn}` : ""}. Three things to try first.`,
    footer: trialing ? "You received this email because you started a Redaxa trial with this address." : "You received this email because you subscribed to Redaxa with this address.",
    help: ["Billing question, or something not working?", "Reply to this email from the address on the account."],
    blocks: [
      { kicker: trialing ? "Trial started" : "Subscription active" },
      { h1: greet(trialing ? "Your trial is running" : "You're all set", firstName) },
      { p: intro },
      { rows },
      { button: { href: appUrl, label: "Open Redaxa" } },
      ...(trialing ? [{ moment: { kicker: "Trial", big: "Seven days, every feature", text: `Nothing is charged before ${renewsOn ?? "the trial ends"}, and you can cancel before then.` } }] : []),
      { h2: "Three things to try first" },
      { list: firstSteps, numbered: true },
      { note: trialing
          ? `Cancel before ${renewsOn ?? "the trial ends"} from Your account, under Subscription & invoices, and nothing is charged.`
          : "Change or cancel the plan from Your account, under Subscription & invoices.",
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
    kind: "welcome",
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
      { moment: { kicker: "Chrome extension", big: "No daily limit", text: "Free checks in the extension run in your browser, on ChatGPT, Claude, Gemini and Perplexity." } },
      { note: "On the web and in the Windows app, the free plan includes 5 prompt checks a day, plus 3 public repository checks a day on the web. Pro removes the daily limit on prompt checks.", title: "Free plan on the web and in Windows" },
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
    kind: "security",
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
    kind: "internal",
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
