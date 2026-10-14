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
    preheader: "One step left: confirm this address to finish creating your Redaxa account.",
    footer: "You are receiving this email because this address was used to create a Redaxa account.",
    blocks: [
      { kicker: "Confirm your email" },
      { h1: "Confirm your email address" },
      { p: "Confirm this address to finish creating your Redaxa account. The button opens Redaxa; select Confirm email there, then sign in with your password." },
      { button: { href: confirmLink, label: "Confirm email address" } },
      { link: { label: "Button not working? Copy this link into your browser:", href: confirmLink } },
      { note: "The link works once. If it has expired, choose Create account on the site and resend the confirmation email." },
      { p: "Did not create an account? Ignore this email and nothing will happen.", muted: true },
    ],
  }) },
  { file: "reset-password.html", dashboard: "Reset password", ...renderEmail({
    subject: "Reset your Redaxa password",
    preheader: "Choose a new password for your Redaxa account. Your current one keeps working until you do.",
    footer: "You are receiving this email because a password reset was requested for your Redaxa account.",
    blocks: [
      { kicker: "Account security" },
      { h1: "Reset your password" },
      { p: "Use the button below to choose a new password for your Redaxa account. Your current password keeps working until you set a new one, and setting it signs out every device." },
      { button: { href: recoveryLink, label: "Choose a new password" } },
      { link: { label: "Button not working? Copy this link into your browser:", href: recoveryLink } },
      { note: "The link works once and expires soon. If you did not ask for a reset, ignore this email: your password stays the same." },
      { p: "We will never ask you to send us your password or this link.", muted: true },
    ],
  }) },
  { file: "magic-link.html", dashboard: "Magic link", frameWitness: "magic-link", ...renderEmail({
    subject: "Your Redaxa sign-in link",
    preheader: "A one-time sign-in link for your Redaxa account.",
    footer: "You are receiving this email because a sign-in link was requested for this address.",
    blocks: [
      { kicker: "Sign-in link" },
      { h1: "Sign in to Redaxa" },
      { p: "Use this one-time link to sign in to your Redaxa account." },
      { button: { href: "{{ .ConfirmationURL }}", label: "Sign in to Redaxa" } },
      { link: { label: "Button not working? Copy this link into your browser:", href: "{{ .ConfirmationURL }}" } },
      { note: "The link works once and expires soon. If you did not ask for it, ignore this email." },
    ],
  }) },
  { file: "change-email.html", dashboard: "Change email address", frameWitness: "change-email", ...renderEmail({
    subject: "Confirm your new Redaxa email address",
    preheader: "Confirm the change of your Redaxa sign-in address.",
    footer: "You are receiving this email because a change of address was requested for a Redaxa account.",
    blocks: [
      { kicker: "Email change" },
      { h1: "Confirm your new address" },
      { p: "A request was made to change the sign-in email of a Redaxa account." },
      { rows: [["Current address", "{{ .Email }}"], ["New address", "{{ .NewEmail }}"]] },
      { button: { href: "{{ .ConfirmationURL }}", label: "Confirm the change" } },
      { link: { label: "Button not working? Copy this link into your browser:", href: "{{ .ConfirmationURL }}" } },
      { note: "Until the change is confirmed, the current address stays active. If you did not ask for this, ignore this email and reset your password." },
    ],
  }) },
  { file: "invite.html", dashboard: "Invite user", ...renderEmail({
    subject: "You are invited to Redaxa",
    preheader: "Accept your invitation to Redaxa.",
    footer: "You are receiving this email because someone invited this address to Redaxa.",
    blocks: [
      { kicker: "Invitation" },
      { h1: "You are invited to Redaxa" },
      { p: "Redaxa checks prompts and repositories for keys, client names and personal data before they are shared with AI. Accept the invitation to activate your account, then choose Forgot password? on the sign-in screen to set your password." },
      { button: { href: "{{ .ConfirmationURL }}", label: "Accept invitation" } },
      { link: { label: "Button not working? Copy this link into your browser:", href: "{{ .ConfirmationURL }}" } },
      { p: "Not expecting this? Ignore this email and nothing will happen.", muted: true },
    ],
  }) },
  { file: "reauthentication.html", dashboard: "Reauthentication", ...renderEmail({
    subject: "Your Redaxa verification code",
    preheader: "Your one-time Redaxa verification code is inside.",
    footer: "You are receiving this email because a sensitive change was requested on your Redaxa account.",
    blocks: [
      { kicker: "Verification code" },
      { h1: "Confirm it is you" },
      { p: "Enter this code in Redaxa to confirm the change you requested:" },
      { code: "{{ .Token }}" },
      { note: "The code works once and expires soon. Do not share it with anyone: Redaxa will never ask you for it." },
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
