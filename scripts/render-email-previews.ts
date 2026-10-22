// Writes every Redaxa email, filled with sample data, to a folder for visual review.
//   npx tsx scripts/render-email-previews.ts <output folder>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { memberLeftHtml, passwordChangedHtml, subscriptionHtml, welcomeHtml, renderEmail } from "../api/_email.js";

const out = process.argv[2];
if (!out) throw new Error("Pass an output folder");
mkdirSync(out, { recursive: true });
const app = "https://redaxa.getcertsprint.com";
const sub = { to: "giulia@example.com", firstName: "Giulia", plan: "personal", interval: "year", priceLabel: "€79.90 / year", renewsOn: "21 October 2026", trialing: true, appUrl: app };
const pages: Record<string, string> = {
  "welcome": welcomeHtml("Giulia", app),
  "trial-started": subscriptionHtml(sub),
  "subscription-confirmed-business": subscriptionHtml({ ...sub, plan: "business", priceLabel: "€449.70 / year", renewsOn: "14 October 2027", trialing: false }),
  "password-changed": passwordChangedHtml("Giulia", "14 October 2026 at 09:41 UTC"),
  "member-left": memberLeftHtml("marco.rossi@acme.example", "Acme Legal", "22 October 2026 at 10:15 UTC"),
  "owner-sale-notice": renderEmail({ subject: "New Redaxa subscription — Pro — Yearly", preheader: "x", footer: "Internal notice for the Redaxa team. Stripe holds the payment record.", blocks: [{ kicker: "New subscription" }, { h1: "New Redaxa subscription" }, { rows: [["Plan", "Pro — Yearly"], ["Account", "giulia@example.com"]] }] }).html,
};
// The Redaxa branch of each Supabase template, with sample values for its placeholders.
const templates = join(process.cwd(), "supabase", "email-templates");
const sample: Record<string, string> = {
  "{{ .TokenHash }}": "4c1f0e9a7b3d5c2e8f6a1b0d9c7e5f3a2b4d6c8e0f1a3b5c7d9e2f4a",
  "{{ .ConfirmationURL }}": "https://example.supabase.co/auth/v1/verify?token=sample&amp;type=signup",
  "{{ .Token }}": "481923", "{{ .Email }}": "giulia@example.com", "{{ .NewEmail }}": "giulia.rossi@example.org",
};
for (const file of readdirSync(templates).filter(name => name.endsWith(".html"))) {
  let html = readFileSync(join(templates, file), "utf8");
  const split = html.indexOf("{{ else }}");
  if (split >= 0) html = html.slice(split + "{{ else }}".length, html.lastIndexOf("{{ end }}"));
  for (const [key, value] of Object.entries(sample)) html = html.split(key).join(value);
  pages[`auth-${file.replace(/\.html$/, "")}`] = html;
}
// Until the site serves the PNG, previews load the local copy of the logo.
const logo = pathToFileURL(join(process.cwd(), "outputs", "redaxa-mark-128.png")).href;
for (const [name, html] of Object.entries(pages)) writeFileSync(join(out, `${name}.html`), html.split(`${app}/outputs/redaxa-mark-128.png`).join(logo));
console.log(`${Object.keys(pages).length} previews in ${out}`);
