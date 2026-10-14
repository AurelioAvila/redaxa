// Parts of the public site that are derived, not typed twice:
//   - llms.txt / llms-full.txt: version from package.json, prices from the SoftwareApplication
//     JSON-LD in index.html, the FAQ from the visible FAQ, the installer hash/signature from
//     release-trust.json (written by scripts/release-trust.mjs from the published release).
//   - a FAQPage JSON-LD built from the visible FAQ items, so markup and page cannot differ.
//   - the "Verify this download" block replacing <!--RELEASE_TRUST--> in index.html.
// build-web.mjs applies them to public/; scripts/seo.test.mjs checks them without writing.
import { readFileSync } from "node:fs";

const ORIGIN = "https://redaxa.getcertsprint.com";
const unescapeHtml = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const stripTags = (s) => unescapeHtml(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

export function readFacts(root) {
  const read = (f) => readFileSync(new URL(f, root), "utf8");
  const html = read("index.html");
  const app = JSON.parse(html.match(/<script type="application\/ld\+json">\s*(\{[\s\S]*?"@type": "SoftwareApplication"[\s\S]*?\})\s*<\/script>/)[1]);
  const version = JSON.parse(read("package.json")).version;
  const trust = JSON.parse(read("release-trust.json")).redaxa;
  // Visible FAQ only; the trial item is rewritten in the browser (data-trial-copy), so it stays out of the markup.
  const faq = [...html.matchAll(/<details class="faq-item"><summary([^>]*)>([\s\S]*?)<\/summary><p([^>]*)>([\s\S]*?)<\/p><\/details>/g)]
    .filter((m) => !/data-trial-copy/.test(m[1] + m[3]))
    .map((m) => ({ q: stripTags(m[2]), a: stripTags(m[4]) }));
  return { app, version, trust, faq };
}

export function renderLlms({ app, version, trust, faq }) {
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
    "Pro adds unlimited prompt checks, protected terms (client and project names), 60 repository checks a day on the web and local repository reviews in the Windows app. Business adds shared protected terms, team policies and metadata-only activity with CSV export, for 1 to 3 users. A trial is offered to eligible new subscribers; its length and terms are shown at checkout. Payments are handled by Stripe.",
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
    "## Pages",
    "",
    `- [How to redact sensitive data before ChatGPT](${ORIGIN}/redact-sensitive-data-before-chatgpt.html)`,
    `- [Check a public GitHub repository for leaked API keys](${ORIGIN}/check-public-github-repo-for-leaked-api-keys.html)`,
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

/** Applies the derived parts to the html of public/index.html. */
export function applyToIndex(html, facts) {
  if (!html.includes("<!--RELEASE_TRUST-->")) throw new Error("index.html lost its RELEASE_TRUST marker");
  // softwareVersion follows package.json, so a version bump cannot leave the structured data behind.
  return html
    .replace(/("softwareVersion":\s*")[^"]*(")/, (_, a, b) => a + facts.version + b)
    .replace("<!--RELEASE_TRUST-->", () => trustBlock(facts.trust))
    .replace("</head>", () => `${faqJsonLd(facts.faq)}\n</head>`);
}
