// Parts of the public site that are derived, not typed twice:
//   - llms.txt / llms-full.txt: version from package.json, prices from the SoftwareApplication
//     JSON-LD in index.html, the FAQ from the visible FAQ, the installer hash/signature from
//     release-trust.json (written by scripts/release-trust.mjs from the published release).
//   - a FAQPage JSON-LD built from the visible FAQ items, so markup and page cannot differ.
//   - the "Verify this download" block replacing <!--RELEASE_TRUST--> in index.html.
//   - the free-trial wording, from the same TRIAL_ENABLED switch the API reads (api/_trial.ts),
//     so pages served without JavaScript describe the trial that checkout will actually give.
//   - prices in guides (<!--PRICE:Offer name-->), from the SoftwareApplication offers.
//   - the Halloween strip and card (<!--PROMO:...-->) and the trial terms under the plan buttons
//     (<!--TRIAL_TERMS:plan-->), from api/_promo.ts and the offers, so pages read without
//     JavaScript show real prices instead of placeholders. landing.ts/promo.ts refine them live.
// build-web.mjs applies them to public/; scripts/seo.test.mjs checks them without writing.
import { readFileSync } from "node:fs";

const ORIGIN = "https://redaxa.getcertsprint.com";
// &amp; last, so "&amp;lt;" stays "&lt;" instead of becoming "<".
const unescapeHtml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// Plain text for llms.txt and JSON-LD: no angle brackets survive, whatever the markup was.
const stripTags = (s) => unescapeHtml(s.split(/<[^>]*>/).join("")).split(/[<>]/).join("").replace(/\s+/g, " ").trim();

/** The trial as checkout will give it: api/_trial.ts reads TRIAL_ENABLED === "true" and TRIAL_DAYS. With the
 *  switch off there is no choice, and a checkout without one still carries the same TRIAL_DAYS trial (only the
 *  Windows app 0.5.5 and older gets LEGACY_TRIAL_DAYS, which no page offers). */
export function trialFacts(root, env = process.env) {
  const source = readFileSync(new URL("api/_trial.ts", root), "utf8");
  const days = Number(source.match(/export const TRIAL_DAYS = (\d+);/)?.[1]);
  if (!days) throw new Error("api/_trial.ts lost TRIAL_DAYS");
  const enabled = env.TRIAL_ENABLED === "true";
  return enabled ? {
    enabled, days,
    short: `Pro and Business start with a ${days}-day free trial: a card or another payment method is needed, nothing is charged for ${days} days, and you can cancel before it ends from Manage subscription.`,
    long: `Pro and Business can start with a ${days}-day free trial, or you can subscribe straight away. A card or another payment method Stripe accepts is needed to start; nothing is charged during the ${days} days. When the trial ends the plan is charged automatically, unless you cancelled it before then from Account & team, Manage subscription. If a payment fails, the plan is paused until a payment goes through. There is one free trial per person (per account, email address and card).`,
  } : {
    enabled, days,
    short: `Eligible new subscribers get a ${days}-day trial; a card is required, and you can cancel before it ends to avoid a charge.`,
    long: `Eligible new subscribers start with a ${days}-day trial. A card is required; cancel before the trial ends to avoid a charge.`,
  };
}

/** The Halloween offer as api/_promo.ts defines it: window and per-plan cents. */
export function promoFacts(root) {
  const source = readFileSync(new URL("api/_promo.ts", root), "utf8");
  const startsAt = source.match(/startsAt: "([^"]+)"/)?.[1];
  const endsAt = source.match(/endsAt: "([^"]+)"/)?.[1];
  const offers = [...source.matchAll(/\{ plan: "(\w+)", interval: "(\w+)",[^}]*?regular: (\d+), reference: (\d+), price: (\d+) \}/g)]
    .map(([, plan, interval, regular, reference, price]) => ({ plan, interval, regular: +regular, reference: +reference, price: +price }));
  if (!startsAt || !endsAt || offers.length !== 4) throw new Error("api/_promo.ts lost its PROMO window or offers");
  return { startsAt, endsAt, offers };
}

/** €39, €79.90: like promo.ts euro() in English. */
const euroCents = (c) => "€" + (c / 100).toFixed(c % 100 ? 2 : 0);
/** Rounded down, like promo.ts promoPercent(). */
const percentOff = (o) => Math.floor(((o.reference - o.price) * 100) / o.reference);

// ponytail: the build only knows the PROMO window, not the PROMO_ID/PROMO_DISABLED switches the API
// reads; if the offer is switched off early, rebuild with the window over (or remove the blocks).
/** Fills the <!--PROMO-->…<!--/PROMO--> blocks while the offer window is open at build time, drops them after. */
export function applyPromo(html, promo, nowMs) {
  const open = nowMs >= Date.parse(promo.startsAt) && nowMs < Date.parse(promo.endsAt);
  if (!open) return html.replace(/<!--PROMO-->[\s\S]*?<!--\/PROMO-->/g, "");
  return html.replace(/<!--\/?PROMO-->/g, "").replace(/<!--PROMO:(\w+)(?: (\w+) (\w+))?-->/g, (_, field, plan, interval) => {
    if (field === "minpercent") return Math.min(...promo.offers.map(percentOff)) + "%";
    const offer = promo.offers.find((o) => o.plan === plan && o.interval === interval);
    if (!offer) throw new Error(`No promo offer ${plan} ${interval}`);
    return field === "percent" ? percentOff(offer) + "%" : euroCents(offer[field]);
  });
}

/** The trial terms under each plan button for the yearly default, as checkout implements them (api/_trial.ts,
 *  api/_promo.ts): length, payment method, what is charged after the trial. landing.ts replaces them with the
 *  dated line once prices load. */
export function trialTermsLine(plan, facts, promoOpen) {
  if (!facts.trial.enabled) return '<p class="plan-choice-line" hidden></p>';
  const name = plan === "business" ? "Business yearly (per user)" : "Pro yearly";
  const regular = facts.app.offers.find((o) => o.name === name);
  if (!regular) throw new Error(`No offer named "${name}"`);
  const per = plan === "business" ? " per user" : "";
  const promo = promoOpen && facts.promo.offers.find((o) => o.plan === plan && o.interval === "yearly");
  const then = promo
    ? `${euroCents(promo.price)}${per} for the first year, and €${regular.price}${per} a year after that`
    : `€${regular.price}${per} a year`;
  return `<p class="plan-choice-line">Free for ${facts.trial.days} days, then ${then}. A card or another payment method is needed to start; cancel before the trial ends and you pay nothing. Prices exclude VAT.</p>`;
}

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

export function readFacts(root, env = process.env) {
  const read = (f) => readFileSync(new URL(f, root), "utf8");
  const html = read("index.html");
  const app = JSON.parse(html.match(/<script type="application\/ld\+json">\s*(\{[\s\S]*?"@type": "SoftwareApplication"[\s\S]*?\})\s*<\/script>/)[1]);
  const version = JSON.parse(read("package.json")).version;
  const trust = JSON.parse(read("release-trust.json")).redaxa;
  const trial = trialFacts(root, env);
  const promo = promoFacts(root);
  // Visible FAQ. The trial item carries the wording applyToIndex writes into the page for this build.
  const pick = (open, inner) => trial.enabled && attr(open, "data-trial-copy") ? withDays(unescapeHtml(attr(open, "data-trial-copy")), trial) : stripTags(inner);
  const faq = [...html.matchAll(/<details class="faq-item"><summary([^>]*)>([\s\S]*?)<\/summary><p([^>]*)>([\s\S]*?)<\/p><\/details>/g)]
    .map((m) => ({ q: pick(m[1], m[2]), a: pick(m[3], m[4]) }));
  return { app, version, trust, faq, trial, promo };
}

export function renderLlms({ app, version, trust, faq, trial }, extra = {}) {
  const offers = app.offers.map((o) => `- ${o.name}: EUR ${o.price}`);
  const core = [
    "# Redaxa",
    "",
    "> Redaxa checks AI prompts and public GitHub repositories for personal data, credentials, financial details and secrets before you share them, and offers a redacted copy you review yourself. It is made by Aurelio Avila (formerly named PromptShield).",
    "",
    "## Where it runs",
    "",
    `- [Web app](${ORIGIN}/): nothing to install.`,
    "- [Chrome extension](https://chromewebstore.google.com/detail/redaxa/clkobbjoaegkgnmkibjghlboeoplpmok): checks a message inside ChatGPT, Claude, Gemini and Perplexity before it sends. Free checks run in the browser and the text does not leave your device.",
    `- Windows desktop app ${version}: https://dl.pctweaker.app/redaxa/Redaxa-Setup.exe , or winget install --id AurelioAvila.Redaxa --exact`,
    "",
    "## Plans (EUR, read from the site's structured data)",
    "",
    "- Free: no account or card for the basic checks. 5 prompt checks a day on the web and in the Windows app, unlimited free checks in the Chrome extension, 3 public repository checks a day on the web.",
    ...offers,
    "",
    `Pro adds prompt checks with no daily limit, your protected terms (client and project names) in the Chrome extension as well as on the web and in Windows, 60 repository checks a day on the web and local repository reviews in the Windows app. Business adds shared protected terms, team policies (warn, redact or block) and metadata-only activity with CSV export, for 1 to 3 users. Prices exclude VAT. Payments are handled by Stripe. ${trial.long}`,
    "",
    "## What leaves your device",
    "",
    "- Free checks in the Chrome extension: nothing; they run in your browser.",
    "- Web, Windows and plan-based checks: the text is sent over an encrypted connection, analyzed and discarded. It is not stored and not forwarded to an AI provider. Activity records, where enabled, hold metadata only (time, application, finding categories and counts).",
    "- Repository checks cover public repositories only; private repositories are not supported. Results are possible exposures, not verified working keys, and detection can miss items or flag harmless text.",
    "",
    "## Verify the Windows download",
    "",
    `- Redaxa ${trust.version}: SHA-256 ${trust.sha256}; Authenticode ${trust.signature.status}, signed by ${trust.signature.signer}${trust.signature.timestamped ? " with a trusted timestamp" : ""}; ${trust.releasePage}`,
    "- In PowerShell: Get-FileHash <file> -Algorithm SHA256 and Get-AuthenticodeSignature <file>.",
    "",
    ...(extra.detectors?.length ? ["## Detection reference (generated from the engine)", "", `- [What Redaxa detects](${ORIGIN}/detectors/): every detector, with real engine output, near misses and known false positives.`, ...extra.detectors.map((d) => `- [${d.name}](${ORIGIN}/detectors/${d.slug}.html): reported as "${d.label}", severity ${d.severity}.`), ""] : []),
    ...(extra.languages?.length ? ["## Other languages", "", ...extra.languages.map((l) => `- [${l.name}](${ORIGIN}/${l.code}/)`), ""] : []),
    "## Pages",
    "",
    `- [Redact personal data and secrets before an AI prompt: example, detectors, where checks run, limits](${ORIGIN}/redact-sensitive-data-before-ai.html)`,
    `- [How to stop API keys leaking into AI prompts](${ORIGIN}/stop-api-keys-leaking-into-ai-prompts.html)`,
    `- [PII redaction browser extension: what runs on your device](${ORIGIN}/pii-redaction-browser-extension.html)`,
    `- [How to redact sensitive data before ChatGPT](${ORIGIN}/redact-sensitive-data-before-chatgpt.html)`,
    `- [Check a public GitHub repository for leaked API keys](${ORIGIN}/check-public-github-repo-for-leaked-api-keys.html)`,
    `- [Free GitHub secret scanner: what the web check reads, its limits and what it does not do](${ORIGIN}/free-github-secret-scanner.html)`,
    `- [Protect client and project names in AI prompts](${ORIGIN}/protect-client-and-project-names-in-ai-prompts.html)`,
    `- [What not to paste into ChatGPT: a checklist](${ORIGIN}/what-not-to-paste-into-chatgpt-checklist.html)`,
    `- [API documentation](${ORIGIN}/api-docs.html)`,
    `- [Privacy Policy](${ORIGIN}/privacy.html), [Terms](${ORIGIN}/terms.html)`,
    `- [Source and release notes](https://github.com/AurelioAvila/redaxa), [llms-full.txt](${ORIGIN}/llms-full.txt)`,
    "",
  ];
  const full = [...core, "## Frequently asked questions", "", ...faq.flatMap((f) => [`### ${f.q}`, "", f.a, ""])];
  return { llms: core.join("\n"), full: full.join("\n") };
}

export function faqJsonLd(faq) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  }).replaceAll("<", "\\u003c")}</script>`;
}

export function trustBlock(trust) {
  return `<details class="verify-download" style="margin:12px 0;font-size:14px;line-height:1.55"><summary style="cursor:pointer;font-weight:600">Verify the Windows download (v${trust.version})</summary><p>Redaxa-Setup.exe is the installer of release v${trust.version}. SHA-256: <code style="word-break:break-all">${trust.sha256}</code>.</p><p>Authenticode signature: ${trust.signature.status}, publisher ${trust.signature.signer}${trust.signature.timestamped ? ", with a trusted timestamp" : ""}. Certificate thumbprint <code style="word-break:break-all">${trust.signature.thumbprint}</code>.</p><p>In PowerShell, from the folder you saved it to:</p><pre style="overflow-x:auto"><code>Get-FileHash .\\Redaxa-Setup.exe -Algorithm SHA256\nGet-AuthenticodeSignature .\\Redaxa-Setup.exe | Format-List Status, SignerCertificate</code></pre></details>`;
}

// landing.ts fills {days} in the browser; the static page and its FAQ JSON-LD need the number already in place.
const withDays = (copy, trial) => copy.replaceAll("{days}", String(trial.days));

/** With the trial switch on, the page ships the trial wording itself; landing.ts keeps the old text in data-legacy-copy. */
export function applyTrialCopy(html, trial) {
  if (!trial.enabled) return html;
  return html.replace(/<(\w+)([^>]*?) data-trial-copy="([^"]*)"([^>]*)>([^<]*)<\/\1>/g,
    (_, tag, before, copy, after, legacy) => `<${tag}${before} data-trial-copy="${copy}" data-legacy-copy="${legacy.replace(/"/g, "&quot;")}"${after}>${withDays(copy, trial)}</${tag}>`);
}

/** <!--PRICE:Pro yearly--> becomes the offer's price; <!--TRIAL--> and <!--TRIAL_LONG--> the trial wording. */
export function applyMarkers(html, facts) {
  const out = html
    .replace(/<!--PRICE:([^>]+?)-->/g, (_, name) => {
      const offer = facts.app.offers.find((o) => o.name === name);
      if (!offer) throw new Error(`No offer named "${name}"`);
      return "€" + offer.price;
    })
    .replace(/<!--TRIAL-->/g, () => facts.trial.short)
    .replace(/<!--TRIAL_LONG-->/g, () => facts.trial.long);
  if (/<!--(?:PRICE|TRIAL)/.test(out)) throw new Error("unreplaced marker");
  return out;
}

/** Applies the derived parts to the html of public/index.html. */
export function applyToIndex(html, facts, nowMs = Date.now()) {
  if (!html.includes("<!--RELEASE_TRUST-->")) throw new Error("index.html lost its RELEASE_TRUST marker");
  const promoOpen = nowMs >= Date.parse(facts.promo.startsAt) && nowMs < Date.parse(facts.promo.endsAt);
  const filled = applyPromo(html, facts.promo, nowMs).replace(/<!--TRIAL_TERMS:(\w+)-->/g, (_, plan) => trialTermsLine(plan, facts, promoOpen));
  if (/<!--(?:PROMO|TRIAL_TERMS)/.test(filled)) throw new Error("unreplaced promo or trial-terms marker");
  // softwareVersion follows package.json, so a version bump cannot leave the structured data behind.
  return applyTrialCopy(filled, facts.trial)
    .replace(/("softwareVersion":\s*")[^"]*(")/, (_, a, b) => a + facts.version + b)
    .replace("<!--RELEASE_TRUST-->", () => trustBlock(facts.trust))
    .replace("</head>", () => `${faqJsonLd(facts.faq)}\n</head>`);
}
