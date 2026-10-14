// Builds supabase/email-templates/*.html, the Supabase Auth templates of the project Redaxa shares
// with Frame Witness. Redaxa's branch comes from the same renderer as every other Redaxa email;
// the Frame Witness branch is generated in its own repository (validation/render_supabase_templates.mjs)
// and stored in supabase/email-templates/frame-witness/. `--check` fails when the files are stale.
//   npx tsx scripts/build-auth-email-templates.ts [--check]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderEmail, SITE_URL } from "../api/_email.js";

const folder = join(process.cwd(), "supabase", "email-templates");
const frameWitness = join(folder, "frame-witness");
const FW_REDIRECT = "https://framewitness.pages.dev/account.html";
/** Checkouts with core.autocrlf have CRLF on disk; the comparison is about content. */
const lf = (text: string): string => text.replace(/\r\n/g, "\n");

type Template = { file: string; dashboard: string; subject: string; html: string; frameWitness?: string };

// Confirmation and reset links open the Redaxa page with a one-time hash in the fragment. The hash is
// only spent when the reader acts there (Confirm email / Set the new password), so mail scanners that
// fetch every link cannot use it up. The other templates keep Supabase's own link.
const confirmLink = `${SITE_URL}/#confirm={{ .TokenHash }}`;
const recoveryLink = `${SITE_URL}/#recovery={{ .TokenHash }}`;

const redaxa: Template[] = [
  { file: "confirm-signup.html", dashboard: "Confirm sign up", frameWitness: "confirm-signup", ...renderEmail({
    subject: "Confirm your email for Redaxa",
    preheader: "One step left: confirm this address, then sign in and run your first check.",
    footer: "You received this email because this address was used to create a Redaxa account. If that was not you, ignore it: nothing is created without the link.",
    help: ["Link expired or already used?", "Choose Create account on the site and resend the confirmation email, or simply sign in if you confirmed already."],
    blocks: [
      { kicker: "Confirm your email" },
      { h1: "One step left" },
      { p: "Select the button: it opens Redaxa, where Confirm email finishes creating your account. Opening the link alone changes nothing, so a mail scanner cannot use it up." },
      { button: { href: confirmLink, label: "Confirm email address" } },
      { link: { label: "If the button does not open, copy this address into your browser:", href: confirmLink } },
      { h2: "Then" },
      { list: ["Sign in with the email and password you chose.", "Paste a prompt with a key or a client name into the checker and see what Redaxa flags.", "Install the Chrome extension or the Windows app to check prompts where you write them."], numbered: true },
      { p: "The link works once. We will never ask you to send us your password or this link.", muted: true },
    ],
  }) },
  { file: "reset-password.html", dashboard: "Reset password", ...renderEmail({
    subject: "Reset your Redaxa password",
    preheader: "The link works once and expires soon. Setting a new password signs out every device.",
    footer: "You received this email because a password reset was requested for the Redaxa account on this address.",
    help: ["Did not ask for this?", "Ignore this email: your password stays the same. If these keep arriving, tell us."],
    blocks: [
      { kicker: "Account security" },
      { h1: "Choose a new password" },
      { p: "Use the button to set a new password for your Redaxa account. Your current password keeps working until you do, and the new one signs out every device, including the Windows app and the extension." },
      { button: { href: recoveryLink, label: "Choose a new password" } },
      { link: { label: "If the button does not open, copy this address into your browser:", href: recoveryLink } },
      { p: "The link works once and expires soon. Use at least 12 characters; a passphrase or a password manager works best.", muted: true },
    ],
  }) },
  { file: "magic-link.html", dashboard: "Magic link", frameWitness: "magic-link", ...renderEmail({
    subject: "Your Redaxa sign-in link",
    preheader: "A one-time sign-in link for your Redaxa account. It expires soon.",
    footer: "You received this email because a sign-in link was requested for this address.",
    help: ["Did not ask for it?", "Ignore this email. Nobody can sign in without the link."],
    blocks: [
      { kicker: "Sign-in link" },
      { h1: "Sign in to Redaxa" },
      { p: "Use this one-time link to sign in to your Redaxa account." },
      { button: { href: "{{ .ConfirmationURL }}", label: "Sign in to Redaxa" } },
      { link: { label: "If the button does not open, copy this address into your browser:", href: "{{ .ConfirmationURL }}" } },
      { p: "The link works once and expires soon.", muted: true },
    ],
  }) },
  { file: "change-email.html", dashboard: "Change email address", frameWitness: "change-email", ...renderEmail({
    subject: "Confirm your new Redaxa email address",
    preheader: "Confirm the change of your Redaxa sign-in address. Nothing moves until you do.",
    footer: "You received this email because a change of address was requested for a Redaxa account linked to it.",
    help: ["Not expecting this?", "Ignore it and choose Forgot password? on the sign-in screen to set a new password, then tell us."],
    blocks: [
      { kicker: "Email change" },
      { h1: "Confirm your new address" },
      { p: "A request was made to change the sign-in email of a Redaxa account. Your plan, protected terms and history stay with the account." },
      { rows: [["Current address", "{{ .Email }}"], ["New address", "{{ .NewEmail }}"]] },
      { button: { href: "{{ .ConfirmationURL }}", label: "Confirm the change" } },
      { link: { label: "If the button does not open, copy this address into your browser:", href: "{{ .ConfirmationURL }}" } },
      { p: "Until the change is confirmed, the current address keeps working.", muted: true },
    ],
  }) },
  { file: "invite.html", dashboard: "Invite user", ...renderEmail({
    subject: "You are invited to Redaxa",
    preheader: "Accept the invitation, then choose your password.",
    footer: "You received this email because someone invited this address to Redaxa.",
    help: ["Not expecting this?", "Ignore this email and nothing will happen."],
    blocks: [
      { kicker: "Invitation" },
      { h1: "You are invited to Redaxa" },
      { p: "Redaxa checks prompts and repositories for keys, client names and personal data before they are shared with AI." },
      { button: { href: "{{ .ConfirmationURL }}", label: "Accept invitation" } },
      { link: { label: "If the button does not open, copy this address into your browser:", href: "{{ .ConfirmationURL }}" } },
      { h2: "Then" },
      { list: ["On the sign-in screen, choose Forgot password? and enter this address.", "Set your password from the email that follows, then sign in."], numbered: true },
    ],
  }) },
  { file: "reauthentication.html", dashboard: "Reauthentication", ...renderEmail({
    subject: "Your Redaxa verification code",
    preheader: "Enter this one-time code in Redaxa to confirm the change you asked for.",
    footer: "You received this email because a sensitive change was requested on the Redaxa account on this address.",
    help: ["Did not ask for it?", "Ignore this email: nothing changes without the code. If these keep arriving, tell us."],
    blocks: [
      { kicker: "Verification code" },
      { h1: "Confirm it is you" },
      { p: "Enter this code in Redaxa to confirm the change you requested:" },
      { code: "{{ .Token }}" },
      { p: "The code works once and expires soon. Do not share it with anyone: Redaxa will never ask you for it.", muted: true },
    ],
  }) },
];

function branch(template: Template): { html: string; subject: string } {
  if (!template.frameWitness) return { html: template.html, subject: template.subject };
  const base = join(frameWitness, template.frameWitness);
  const html = lf(readFileSync(`${base}.html`, "utf8")).trim();
  const subject = lf(readFileSync(`${base}.subject.txt`, "utf8")).trim();
  return {
    html: `{{ if eq .RedirectTo "${FW_REDIRECT}" }}${html}{{ else }}${template.html}{{ end }}`,
    subject: `{{ if eq .RedirectTo "${FW_REDIRECT}" }}${subject}{{ else }}${template.subject}{{ end }}`,
  };
}

const check = process.argv.includes("--check");
const subjects: string[] = ["| File | Dashboard template | Subject field |", "|---|---|---|"];
let stale = 0;
for (const template of redaxa) {
  const { html, subject } = branch(template);
  for (const forbidden of [/illustrative/i, /promptshield/i, /<script/i]) if (forbidden.test(html)) throw new Error(`${template.file} contains ${forbidden}`);
  const target = join(folder, template.file);
  if (check) { if (!existsSync(target) || lf(readFileSync(target, "utf8")) !== html) { console.error(`stale: ${template.file}`); stale++; } }
  else writeFileSync(target, html);
  // A subject with a pipe would break the table; none has one, so refuse rather than escape.
  if (subject.includes("|") || subject.includes("`")) throw new Error(`${template.file}: subject cannot go in the table`);
  subjects.push(`| \`${template.file}\` | ${template.dashboard} | \`${subject}\` |`);
}
const table = join(folder, "SUBJECTS.md");
const tableText = `# Subject fields\n\nPaste each value into the Subject field of the matching dashboard template.\n\n${subjects.join("\n")}\n`;
if (check) { if (!existsSync(table) || lf(readFileSync(table, "utf8")) !== tableText) { console.error("stale: SUBJECTS.md"); stale++; } }
else writeFileSync(table, tableText);
if (stale) { console.error("Run: npx tsx scripts/build-auth-email-templates.ts"); process.exit(1); }
console.log(check ? "Supabase email templates are up to date." : `Wrote ${redaxa.length} templates and SUBJECTS.md`);
