/**
 * Every email Redaxa sends itself, in one layout: the Paper palette with its
 * copper accent, the site's own identity, pinned so a dark mail app does not
 * invert it. The Supabase Auth templates are generated from the same
 * renderer (scripts/build-auth-email-templates.ts), so a confirmation link and
 * a subscription receipt look like they came from the same product.
 *
 * Sending is best-effort by design. A failure here must never fail the
 * webhook: Stripe would retry the whole delivery and re-run everything that
 * already succeeded, and the customer's access does not depend on the mail.
 */

import { readyProviders, sendEmail } from "./_email-relay.js";

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

// Redaxa emails, design kit v4 "Paper & copper": the product's own identity, with the tokens of the
// live site's CSS. A 4 px copper rule; an ink header with the mark, the wordmark, one small-caps
// eyebrow, the title and the intro; paper sections where facts sit in white cards on a fixed label
// grid and steps are hairline rows; one copper band (the moment); a help panel on a copper rule; the
// footer outside the card, on the page colour. Nothing is a gradient or a decoration. The scheme is
// declared light and every surface is pinned for Apple Mail and Outlook.com, so no client inverts the
// paper. Contrast: copper on paper 5.6:1, muted on paper 6.8:1, white on copper 6.0:1.
const P = { page: "#f2f0ea", card: "#f7f6f2", white: "#ffffff", line: "#e3dfd5", rule: "#d9d4c8", ink: "#1b1724", muted: "#5a5466", copper: "#a3471d", paper: "#f7f6f2", headMuted: "#c5bfcf", headText: "#e4e0ea", onCopper: "#f8e8df" };
const SANS = "font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;";
const MONO = "font-family:Consolas,Menlo,'Courier New',monospace;";

export type EmailKind = "account" | "security" | "billing" | "welcome" | "internal";
const KIND_LABEL: Record<EmailKind, string> = { account: "Account", security: "Security notice", billing: "Billing", welcome: "Welcome", internal: "Team notice" };

/** A content block. Strings are plain text; the renderer escapes them. The kicker, the h1 and the
 *  first p open the message in the header; the rest fill the sections below it. `text` replaces the
 *  block's line in the plain-text part ("" leaves it out). */
export type Block = (
  | { kicker: string }
  | { h1: string }
  /** A section label; it opens a new section, on the darker paper when `alt`. */
  | { h2: string; alt?: boolean }
  | { p: string; muted?: boolean }
  | { note: string; title?: string }
  /** Label, value and, optionally, the value as the text part should read it. */
  | { rows: Array<[string, string, string?]>; /** The last row is the key row: copper, on the darker paper. */ total?: boolean }
  | { list: string[]; numbered?: boolean }
  | { button: { href: string; label: string } }
  | { code: string }
  | { link: { label: string; href: string } }
  | { security: [string, string] }
  /** A sample prompt as Redaxa shows it: plain text, and values flagged as copper bars of the given length. */
  | { checked: Array<[string, number?]> }
  | { moment: { kicker: string; big: string; text: string } }
) & { text?: string };

export type EmailInput = {
  subject: string;
  /** Sets the header eyebrow when no kicker does. */
  kind?: EmailKind;
  /** The line an inbox shows next to the subject. */
  preheader: string;
  blocks: Block[];
  /** Why the reader got this message. */
  footer: string;
  /** The help panel at the bottom: a question the reader may have, and what to send. */
  help?: [string, string];
  /** Security notices carry nothing clickable at all: whoever reads one is
   *  not necessarily the person who acted, and a link there is the exact
   *  shape an attacker would forge on the message a worried reader clicks. */
  noLinks?: boolean;
};

const cap = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** The bulletproof button: VML for Outlook's Word engine, a padded link everywhere else. */
function button(href: string, label: string, top: number): string {
  const e = escapeHtml;
  const width = Math.min(520, Math.max(180, Math.round(label.length * 10) + 30));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn" style="margin:${top}px 0 0;"><tr><td align="center" class="acc" bgcolor="${P.copper}" style="border-radius:6px;background:${P.copper};">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${e(href)}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="12%" stroke="f" fillcolor="${P.copper}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:700;">${e(label)}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!--><a href="${e(href)}" class="accink" style="display:inline-block;padding:14px 32px;${SANS}font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;background:${P.copper};">${e(label)}</a><!--<![endif]--></td></tr></table>`;
}

type Item = { kind: string; html: (top: number) => string };
type Section = { alt: boolean; items: Item[] } | { moment: { kicker: string; big: string; text: string } } | { help: true };

/** Renders one message as HTML and plain text from the same blocks, so the two cannot disagree. */
export function renderEmail(input: EmailInput): { subject: string; html: string; text: string } {
  const e = escapeHtml;
  const hero: { kicker?: string; h1?: string; p?: string } = {};
  const sections: Section[] = [];
  const text: string[] = [];
  // A section label is printed on the line above the next block's text, not as a paragraph of its own.
  let heading: string | null = null;
  const say = (chunk: string): void => {
    if (heading !== null) { chunk = chunk ? `${heading}\n${chunk}` : heading; heading = null; }
    if (chunk) text.push(chunk);
  };
  const open = (alt: boolean): { alt: boolean; items: Item[] } => { const section = { alt, items: [] as Item[] }; sections.push(section); return section; };
  const add = (kind: string, html: (top: number) => string): void => {
    const last = sections[sections.length - 1];
    (last && "items" in last ? last : open(false)).items.push({ kind, html });
  };
  const white = (inner: string, top: number, border = P.line, padding = "4px 24px"): string =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="white" bgcolor="${P.white}" style="margin:${top}px 0 0;background:${P.white};border:1px solid ${border};border-radius:8px;"><tr><td style="padding:${padding};">${inner}</td></tr></table>`;
  const grid = (rows: Array<[string, string]>, strong: boolean): string =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.map(([key, value], i) => {
      const rule = i ? `border-top:1px solid ${P.line};` : "";
      return strong
        ? `<tr><td class="ink lbl" width="176" valign="top" style="width:176px;padding:12px 16px 12px 0;${rule}${SANS}font-size:14px;line-height:22px;font-weight:700;color:${P.ink};">${e(key)}</td><td class="ink" valign="top" style="padding:12px 0;${rule}${SANS}font-size:15px;line-height:22px;color:${P.ink};">${e(value)}</td></tr>`
        : `<tr><td class="muted lbl" width="176" valign="top" style="width:176px;padding:12px 16px 12px 0;${rule}${SANS}font-size:14px;line-height:20px;color:${P.muted};">${e(key)}</td><td class="ink" valign="top" style="padding:12px 0;${rule}${SANS}font-size:15px;line-height:20px;font-weight:600;color:${P.ink};word-break:break-word;">${e(value)}</td></tr>`;
    }).join("")}</table>`;
  const muted = (value: string, top: number, size = "14px;line-height:21px"): string =>
    `<p class="muted" style="margin:${top}px 0 0;${SANS}font-size:${size};color:${P.muted};">${value}</p>`;

  for (const block of input.blocks) {
    if ("kicker" in block) hero.kicker = block.kicker;
    else if ("h1" in block) { hero.h1 = block.h1; say(block.text ?? block.h1); }
    else if ("p" in block && !block.muted && hero.p === undefined && sections.length === 0) { hero.p = block.p; say(block.text ?? block.p); }
    else if ("h2" in block) {
      const last = sections[sections.length - 1];
      if (!last || !("items" in last) || last.items.length || last.alt !== Boolean(block.alt)) open(Boolean(block.alt));
      add("h2", top => `<p class="muted" style="margin:${top}px 0 0;${SANS}font-size:12px;line-height:16px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${P.muted};">${e(block.h2)}</p>`);
      heading = block.text ?? block.h2;
    } else if ("p" in block) {
      add(block.muted ? "muted" : "p", top => block.muted ? muted(e(block.p), top)
        : `<p class="ink" style="margin:${top}px 0 0;${SANS}font-size:16px;line-height:24px;color:${P.ink};">${e(block.p)}</p>`);
      say(block.text ?? block.p);
    } else if ("note" in block) {
      add("note", top => white((block.title ? `<p class="ink" style="margin:0 0 4px;${SANS}font-size:15px;line-height:22px;font-weight:700;color:${P.ink};">${e(block.title)}</p>` : "") +
        `<p class="ink" style="margin:0;${SANS}font-size:14px;line-height:21px;color:${P.ink};">${e(block.note)}</p>`, top, P.line, "16px 24px"));
      say(block.text ?? (block.title ? `${block.title}\n${block.note}` : block.note));
    } else if ("rows" in block) {
      const rows = block.rows.map(([key, value]): [string, string] => [key, value]);
      const key = block.total ? rows.pop() : undefined;
      add("rows", top => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="white" bgcolor="${P.white}" style="margin:${top}px 0 0;background:${P.white};border:1px solid ${P.line};border-radius:8px;">` +
        (rows.length ? `<tr><td style="padding:${key ? "4px 24px 0" : "4px 24px"};">${grid(rows, false)}</td></tr>` : "") +
        (key ? `<tr><td class="alt" bgcolor="${P.page}" style="background:${P.page};padding:12px 24px;${rows.length ? `border-top:1px solid ${P.line};` : ""}border-radius:${rows.length ? "0 0 7px 7px" : "7px"};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ink lbl" width="176" valign="middle" style="width:176px;padding:0 16px 0 0;${SANS}font-size:14px;line-height:24px;font-weight:600;color:${P.ink};">${e(key[0])}</td><td class="cop" valign="middle" style="${SANS}font-size:18px;line-height:24px;font-weight:700;color:${P.copper};">${e(key[1])}</td></tr></table></td></tr>` : "") +
        "</table>");
      say(block.text ?? block.rows.map(([label, value, plain]) => `${label}: ${plain ?? value}`).join("\n"));
    } else if ("list" in block) {
      add("list", top => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:${top}px 0 0;">${block.list.map((item, i) => {
        const edge = `border-top:1px solid ${P.rule};${i === block.list.length - 1 ? `border-bottom:1px solid ${P.rule};` : ""}`;
        return `<tr><td width="40" valign="top" style="width:40px;padding:16px 0;${edge}${MONO}font-size:14px;line-height:24px;font-weight:700;color:${P.copper};">${block.numbered ? String(i + 1).padStart(2, "0") : "&#8212;"}</td><td class="ink" valign="top" style="padding:16px 0;${edge}${SANS}font-size:16px;line-height:24px;color:${P.ink};">${e(item)}</td></tr>`;
      }).join("")}</table>`);
      say(block.text ?? block.list.map((item, i) => `${block.numbered ? `${i + 1}.` : "-"} ${item}`).join("\n"));
    } else if ("button" in block) {
      add("button", top => button(block.button.href, block.button.label, top));
      say(block.text ?? `${block.button.label}: ${block.button.href}`);
    } else if ("code" in block) {
      add("code", top => white(`<p class="ink otp" style="margin:0;padding-left:6px;${MONO}font-size:32px;line-height:40px;font-weight:700;letter-spacing:6px;color:${P.ink};text-align:center;">${e(block.code)}</p>`, top, P.copper, "24px"));
      say(block.text ?? block.code);
    } else if ("link" in block) {
      // The button's line in the text part already carries the address.
      add("link", top => muted(`${e(block.link.label)}<br><a href="${e(block.link.href)}" style="color:${P.copper};word-break:break-all;">${e(block.link.href)}</a>`, top, "13px;line-height:20px"));
      say(block.text ?? "");
    } else if ("security" in block) {
      add("rows", top => white(grid([["If this was you", cap(block.security[0])], ["If it was not", cap(block.security[1])]], true), top));
      say(block.text ?? `If this was you: ${block.security[0]}\n\nIf it was not: ${block.security[1]}`);
    } else if ("checked" in block) {
      const bars = (count: number): string => `<span style="color:${P.copper};letter-spacing:-1px;">${"&#9608;".repeat(count)}</span> <span class="muted" style="font-size:12px;color:${P.muted};">flagged</span>`;
      add("checked", top => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="white" bgcolor="${P.white}" style="margin:${top}px 0 0;background:${P.white};border:1px solid ${P.rule};border-radius:8px;"><tr><td class="ink" style="padding:20px 24px;${MONO}font-size:15px;line-height:28px;color:${P.ink};">` +
        block.checked.map(([line, flagged]) => e(line) + (flagged ? bars(flagged) : "")).join("<br>") + "</td></tr></table>");
      say(block.text ?? block.checked.map(([line, flagged]) => `  ${line}${flagged ? `${"#".repeat(flagged)} (flagged)` : ""}`).join("\n"));
    } else if ("moment" in block) {
      sections.push({ moment: block.moment });
      say(block.text ?? `${block.moment.kicker}: ${block.moment.big}. ${block.moment.text}`);
    }
  }
  sections.push({ help: true });

  const site = SITE_URL;
  const logo = (size: number, alt: string): string => `<img src="${site}/outputs/redaxa-mark-128.png" width="${size}" height="${size}" alt="${alt}" style="display:block;width:${size}px;height:${size}px;border-radius:${size / 4}px;">`;
  const linked = (inner: string, style = "text-decoration:none;"): string => input.noLinks ? inner : `<a href="${site}/" style="${style}">${inner}</a>`;
  const [helpTitle, helpText] = input.help ?? ["Something not as described?", "Reply to this email with what you were doing and what you saw."];
  const write = /^Reply/.test(helpText) ? "Or write to" : "Write to";
  const support = input.noLinks ? SUPPORT_ADDRESS : `<a href="mailto:${SUPPORT_ADDRESS}" style="color:${P.copper};">${SUPPORT_ADDRESS}</a>`;
  const footLink = (href: string, label: string): string => `<a href="${href}" style="color:${P.muted};">${label}</a>`;
  const links = input.noLinks
    ? "redaxa.getcertsprint.com"
    : [footLink(`${site}/`, "redaxa.getcertsprint.com"), footLink(`${site}/privacy.html`, "Privacy"), footLink(`${site}/terms.html`, "Terms"), footLink(`mailto:${SUPPORT_ADDRESS}`, "Support")].join(" &nbsp;&middot;&nbsp; ");

  // Spacing on the 8 px grid: 32 px above the first section; 24 px between sections of different
  // paper; two sections of the same paper read as one, so they meet on 32 px (40 px after a button).
  const kindOf = (section: Section | undefined): string => !section ? "end" : "moment" in section ? "moment" : "help" in section ? "card" : section.alt ? "alt" : "card";
  const endsWithButton = (section: Section | undefined): boolean => Boolean(section && "items" in section && section.items[section.items.length - 1]?.kind === "button");
  const gap = (previous: string | undefined, kind: string): number =>
    !previous ? 0 : previous === "h2" ? 8 : kind === "link" && previous === "button" ? 16 : kind === "muted" ? (previous === "checked" ? 12 : 16) : 24;
  const body = sections.map((section, i) => {
    const before = sections[i - 1];
    const sameBefore = before !== undefined && kindOf(before) === kindOf(section);
    const top = i === 0 ? 32 : sameBefore ? (endsWithButton(before) ? 16 : 24) : 24;
    if ("moment" in section) {
      const long = section.moment.big.length > 26;
      return `  <tr><td class="acc pad" bgcolor="${P.copper}" style="background:${P.copper};padding:24px 40px;">
    <p class="acc2" style="margin:0 0 4px;${SANS}font-size:12px;line-height:16px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${P.onCopper};">${e(section.moment.kicker)}</p>
    <p class="${long ? "bigs" : "big"} accink" style="margin:0 0 8px;${SANS}font-size:${long ? "26px;line-height:32px;font-weight:700;letter-spacing:-0.3px" : "32px;line-height:40px;font-weight:700;letter-spacing:-0.4px"};color:#ffffff;">${e(section.moment.big)}</p>
    <p class="acc2" style="margin:0;${SANS}font-size:14px;line-height:21px;color:${P.onCopper};">${e(section.moment.text)}</p>
  </td></tr>`;
    }
    if ("help" in section) {
      return `  <tr><td class="card pad" bgcolor="${P.card}" style="background:${P.card};padding:${top}px 40px 32px;border-radius:0 0 8px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="white" bgcolor="${P.white}" style="background:${P.white};border:1px solid ${P.line};border-left:3px solid ${P.copper};border-radius:0 8px 8px 0;"><tr><td style="padding:16px 24px;">
      <p class="ink" style="margin:0 0 4px;${SANS}font-size:15px;line-height:22px;font-weight:700;color:${P.ink};">${e(helpTitle)}</p>
      <p class="muted" style="margin:0;${SANS}font-size:14px;line-height:21px;color:${P.muted};">${e(helpText)} ${write} ${support}. Never send a password or an API key by email.</p>
    </td></tr></table>
  </td></tr>`;
    }
    const after = sections[i + 1];
    const sameAfter = kindOf(after) === kindOf(section);
    const bottom = sameAfter ? (endsWithButton(section) ? 24 : 8) : endsWithButton(section) ? 32 : 24;
    const shade = section.alt ? { cls: "alt", bg: P.page } : { cls: "card", bg: P.card };
    return `  <tr><td class="${shade.cls} pad" bgcolor="${shade.bg}" style="background:${shade.bg};padding:${top}px 40px ${bottom}px;">
    ${section.items.map((item, j) => item.html(gap(section.items[j - 1]?.kind, item.kind))).join("\n    ")}
  </td></tr>`;
  }).join("\n\n");

  const pins = `.bg{background:${P.page}!important}.card{background:${P.card}!important}.white{background:${P.white}!important}.alt{background:${P.page}!important}.head{background:${P.ink}!important}.acc{background:${P.copper}!important}.ink{color:${P.ink}!important}.muted{color:${P.muted}!important}.paper{color:${P.paper}!important}.hm{color:${P.headMuted}!important}.hi{color:${P.headText}!important}.accink{color:#ffffff!important}.acc2{color:${P.onCopper}!important}.cop{color:${P.copper}!important}`;
  const ogsc = pins.replace(/(^|\})\./g, "$1[data-ogsc] .");

  const document = `<!doctype html>
<html lang="en" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<title>${e(input.subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  body,table,td,p,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table,td{mso-table-lspace:0;mso-table-rspace:0;border-collapse:collapse}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;display:block}
  body{margin:0;padding:0;width:100%!important}
  a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
  @media only screen and (max-width:620px){
    .wrap{padding:16px 8px!important}.pad{padding-left:24px!important;padding-right:24px!important}
    .h1{font-size:26px!important;line-height:32px!important}.big{font-size:28px!important;line-height:34px!important}.bigs{font-size:22px!important;line-height:28px!important}
    .btn a{display:block!important;text-align:center!important}.lbl{width:112px!important}.otp{font-size:24px!important;letter-spacing:4px!important}
  }
  @media (prefers-color-scheme:dark){${pins}}
  ${ogsc}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${P.page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${P.page};">${e(input.preheader)}${"&#8199;&#847;".repeat(60)}</div>

<table lang="en" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${P.page}" style="background:${P.page};">
<tr><td align="center" class="wrap" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:600px;margin:0 auto;">

  <tr><td class="acc" bgcolor="${P.copper}" style="height:4px;font-size:0;line-height:0;background:${P.copper};border-radius:8px 8px 0 0;">&nbsp;</td></tr>
  <tr><td class="head pad" bgcolor="${P.ink}" style="background:${P.ink};padding:32px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="40" valign="middle" style="width:40px;padding:0 12px 0 0;">${linked(logo(40, "Redaxa"))}</td>
      <td valign="middle" class="paper" style="${SANS}font-size:18px;line-height:24px;font-weight:700;letter-spacing:-0.2px;color:${P.paper};">${linked("Redaxa", `color:${P.paper};text-decoration:none;`)}</td>
      <td align="right" valign="middle" class="hm" style="${SANS}font-size:12px;line-height:16px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${P.headMuted};">${e(hero.kicker ?? KIND_LABEL[input.kind ?? "account"])}</td>
    </tr></table>
    <h1 class="h1 paper" style="margin:40px 0 ${hero.p ? 12 : 0}px;${SANS}font-size:30px;line-height:36px;font-weight:700;letter-spacing:-0.4px;color:${P.paper};">${e(hero.h1 ?? input.subject)}</h1>
    ${hero.p ? `<p class="hi" style="margin:0;${SANS}font-size:16px;line-height:25px;font-weight:400;color:${P.headText};">${e(hero.p)}</p>` : ""}
  </td></tr>

${body}

  <tr><td class="pad" style="padding:24px 40px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="24" valign="middle" style="width:24px;padding:0 8px 0 0;">${logo(24, "")}</td>
      <td valign="middle" class="ink" style="${SANS}font-size:14px;line-height:20px;font-weight:700;color:${P.ink};">Redaxa <span class="muted" style="font-weight:400;color:${P.muted};">&nbsp;Share the work. Keep the secrets.</span></td>
    </tr></table>
    <p class="muted" style="margin:12px 0 8px;${SANS}font-size:12px;line-height:18px;color:${P.muted};">${e(input.footer)}</p>
    <p class="muted" style="margin:0;${SANS}font-size:12px;line-height:18px;color:${P.muted};">${links}</p>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
  const footerText = `${helpTitle} ${helpText} ${write} ${SUPPORT_ADDRESS}. Never send a password or an API key by email.\n\n--\n${input.footer}\n${input.noLinks ? "Redaxa · redaxa.getcertsprint.com" : `Redaxa · ${site}/ · Privacy: ${site}/privacy.html · Terms: ${site}/terms.html · Support: ${SUPPORT_ADDRESS}`}`;
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
  const rows: Array<[string, string, string?]> = [["Plan", planLabel(plan, interval)]];
  if (priceLabel) rows.push(["Price", priceLabel]);
  rows.push(trialing ? ["Charged so far", "Nothing", "nothing"] : ["Works in", "The web, the Windows app and the Chrome extension", "the web, the Windows app and the Chrome extension"]);
  if (renewsOn) rows.push([trialing ? "First charge" : "Renews on", renewsOn]);
  const until = renewsOn ?? "the trial ends";
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
    preheader: trialing ? `Nothing is charged before ${until}. Three things to try first.` : `Plan ${planLabel(plan, interval)}${renewsOn ? `, renews on ${renewsOn}` : ""}. Three things to try first.`,
    footer: trialing ? "You received this email because you started a Redaxa trial with this address." : "You received this email because you subscribed to Redaxa with this address.",
    help: ["Billing question, or something not working?", "Reply to this email from the address on the account."],
    blocks: [
      { kicker: trialing ? "Trial started" : "Subscription active" },
      { h1: greet(trialing ? "Your trial is running" : "You're all set", firstName) },
      { p: intro },
      { rows, total: Boolean(renewsOn) },
      { button: { href: appUrl, label: "Open Redaxa" } },
      { h2: "Three things to try first" },
      { list: firstSteps, numbered: true },
      ...(trialing
        ? [{ p: `Cancel before ${until} from Your account, under Subscription & invoices, and nothing is charged.`, muted: true },
          { moment: { kicker: "Trial", big: "Seven days, every feature", text: `Nothing is charged before ${until}, and you can cancel before then.` },
            text: `Trial: seven days, every feature. Nothing is charged before ${until}, and you can cancel before then.` }]
        : [{ moment: { kicker: "Managing the plan", big: "Your account", text: "Change or cancel the plan from Your account, under Subscription & invoices." },
          text: "Managing the plan: change or cancel the plan from Your account, under Subscription & invoices." }]),
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
 * The one way out for mail: Resend, then SMTP2GO and Mailjet once their keys
 * are set (_email-relay.ts, the same file every product carries). A provider
 * without its key is skipped; the next one only gets a message the previous one
 * did not take. `text` is not optional: HTML-only mail is a spam signal in
 * itself, and for a product sold on privacy a confirmation landing in junk is
 * the worst possible first impression.
 */
async function send(to: string, subject: string, html: string, text: string, idempotencyKey?: string): Promise<boolean> {
  if (!readyProviders().length || !to) return false;
  const from = sender();
  if (!from) {
    console.error("redaxa mail not sent: a mail provider key is set but REDAXA_MAIL_FROM is not");
    return false;
  }
  // replyTo, because every message invites a reply and the address it is sent
  // from is a noreply@: a promise the transport quietly breaks is worse than
  // not making it.
  const result = await sendEmail({ from, to, subject, html, text, replyTo: SUPPORT_ADDRESS, idempotencyKey }, { timeoutMs: 10000 }).catch(() => null);
  if (!result?.ok) {
    console.error("redaxa mail failed", result?.error ?? "relay_error");
    return false;
  }
  return true;
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
      // A made-up sample, said so in the caption: no real key or host is quoted anywhere.
      { h2: "A checked prompt", alt: true, text: "A checked prompt (the values are made up)" },
      { checked: [["Deploy fails on staging. Config is:"], ["api_key = ", 12], ["host = ", 9], ["What should I check first?"]],
        text: "  Deploy fails on staging. Config is:\n  api_key = ############ (flagged)\n  host = ######### (flagged)\n  What should I check first?\nThe key and the host are flagged before the prompt is sent; the question itself still reads the same." },
      { p: "The key and the host are flagged before the prompt is sent; the question itself still reads the same. The values above are made up.", muted: true, text: "" },
      { h2: "Free plan on the web and in Windows" },
      { rows: [["Prompt checks", "5 a day, on the web and in the Windows app"], ["Public repository checks", "3 a day, on the web"], ["Pro", "Removes the daily limit on prompt checks", "removes the daily limit on prompt checks"]] },
      { p: "We will never ask you for a password or an API key by email.", muted: true },
      { moment: { kicker: "Chrome extension", big: "No daily limit", text: "Free checks in the extension run in your browser, on ChatGPT, Claude, Gemini and Perplexity." },
        text: "Chrome extension: no daily limit. Free checks in the extension run in your browser, on ChatGPT, Claude, Gemini and Perplexity." },
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
      { moment: { kicker: "Changed on", big: when, text: "Every device that was signed in to the account has been signed out." }, text: `Changed on: ${when}` },
    ],
  });
}
export function passwordChangedHtml(firstName: string | null | undefined, when: string): string { return passwordChangedEmail(firstName, when).html; }
export function passwordChangedText(firstName: string | null | undefined, when: string): string { return passwordChangedEmail(firstName, when).text; }

/** Sends the notice. Never throws; the password has already changed. */
export async function sendPasswordChangedEmail(to: string, firstName: string | null | undefined): Promise<boolean> {
  // "14 October 2026 at 09:41 UTC" rather than toUTCString()'s "Wed, 14 Oct 2026 09:41:00 GMT".
  const mail = passwordChangedEmail(firstName, `${new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} UTC`);
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
