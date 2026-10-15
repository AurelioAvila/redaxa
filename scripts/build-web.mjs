import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { applyMarkers, applyToIndex, readFacts, renderLlms } from "./site-generated.mjs";
import { buildDetectors } from "./site-detectors.mjs";
import { alternates, buildLanguages } from "./site-i18n.mjs";
import { sitemapIndex, urlset } from "./site-sitemaps.mjs";

const root = process.cwd();
const output = resolve(root, "public");
if(dirname(output)!==resolve(root)||basename(output)!=='public')throw new Error('Unsafe build output path');

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ["index.html", "dashboard.html", "github.html", "repository.css", "brand-system.css", "themes.css", "app.css", "plans.css", "dialogs.css", "theme-boot.js", "cf-beacon.js", "privacy.html", "terms.html", "api-docs.html", "redact-sensitive-data-before-chatgpt.html", "check-public-github-repo-for-leaked-api-keys.html", "protect-client-and-project-names-in-ai-prompts.html", "what-not-to-paste-into-chatgpt-checklist.html", "stop-api-keys-leaking-into-ai-prompts.html", "pii-redaction-browser-extension.html", "404.html", "lang-pref.js", "auth.css", "manifest.webmanifest", "service-worker.js", "robots.txt", "sitemap-pages.xml", "sitemap-guides.xml", "50dbe3a3e39c297a807eb935fcdaba29.txt"]) {
  cpSync(resolve(root, file), resolve(output, file));
}

// Derived parts of the public site (see site-generated.mjs): llms.txt, FAQPage JSON-LD, verify-download block.
const rootUrl = new URL("../", import.meta.url);
const facts = readFacts(rootUrl);
const indexFile = resolve(output, "index.html");
const hreflang = alternates().map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`).join("\n    ");
writeFileSync(indexFile, applyToIndex(readFileSync(indexFile, "utf8"), facts).replace(/(<link rel="canonical"[^>]*>)/, (m) => `${m}\n    ${hreflang}`));
// Guides: prices from the offers and the trial wording for this build's switch.
for (const file of ["redact-sensitive-data-before-chatgpt.html", "check-public-github-repo-for-leaked-api-keys.html", "protect-client-and-project-names-in-ai-prompts.html", "what-not-to-paste-into-chatgpt-checklist.html", "stop-api-keys-leaking-into-ai-prompts.html", "pii-redaction-browser-extension.html"]) {
  const path = resolve(output, file);
  writeFileSync(path, applyMarkers(readFileSync(path, "utf8"), facts));
}
// Detection reference and localized landing pages, generated from the engine and the product's own translations.
const detectors = await buildDetectors(rootUrl, facts);
const languages = await buildLanguages(rootUrl, facts);
for (const file of [...detectors.files, ...languages.files]) {
  mkdirSync(dirname(resolve(output, file.path)), { recursive: true });
  writeFileSync(resolve(output, file.path), file.html);
}
// Sitemaps by silo: pages and guides are maintained by hand, the generated ones follow their generator.
writeFileSync(resolve(output, "sitemap-detectors.xml"), urlset(detectors.files.map((f) => ({ loc: f.url, lastmod: detectors.updated }))));
writeFileSync(resolve(output, "sitemap-languages.xml"), urlset(languages.files.map((f) => ({ loc: f.url, lastmod: detectors.updated }))));
writeFileSync(resolve(output, "sitemap.xml"), sitemapIndex(output, ["sitemap-pages.xml", "sitemap-guides.xml", "sitemap-detectors.xml", "sitemap-languages.xml"]));
const { llms, full } = renderLlms(facts, {
  detectors: detectors.pages.map((p) => ({ slug: p.slug, name: p.name, label: p.mainLabel, severity: p.examples[0].findings.find((f) => f.label === p.mainLabel).severity })),
  languages: languages.files.map((f) => ({ code: f.code, name: f.name })),
});
writeFileSync(resolve(output, "llms.txt"), llms);
writeFileSync(resolve(output, "llms-full.txt"), full);

// scanner.js/scanner.test.js are deliberately left out of the public bundle:
// only dashboard.ts/auth.ts import *types* from scanner.ts (erased at compile
// time), never the runtime module, so nothing legitimate needs it shipped as
// a static file -- and shipping it anyway would let anyone call inspectPrompt()
// straight from the browser console, fully bypassing the trial/subscription
// gate that api/scan.ts enforces server-side.
mkdirSync(resolve(output, 'dist'), {recursive:true});
for(const module of ['themes','auth','dashboard','desktop','pwa','landing','growth','promo','trial','halloween-decor','repository-ui','repository-report','repository-example']) {
  cpSync(resolve(root,'dist',module+'.js'),resolve(output,'dist',module+'.js'));
}
// RFC 9116: where to report a vulnerability, at the standard path.
mkdirSync(resolve(output, ".well-known"), { recursive: true });
cpSync(resolve(root, ".well-known", "security.txt"), resolve(output, ".well-known", "security.txt"));
mkdirSync(resolve(output, "outputs"), { recursive: true });
cpSync(resolve(root, "outputs", "redaxa-mark.svg"), resolve(output, "outputs", "redaxa-mark.svg"));
// Email clients do not render SVG: the PNG is the logo in every Redaxa email.
cpSync(resolve(root, "outputs", "redaxa-mark-128.png"), resolve(output, "outputs", "redaxa-mark-128.png"));
// og-image.png is the 1200x630 social card, not the 1024x1024 app mark: link
// previews on X/LinkedIn/Slack need the wide ratio, and a square source gets
// centre-cropped into an unreadable tile.
cpSync(resolve(root, "brand", "og-image.png"), resolve(output, "og-image.png"));

for(const file of ["redaxa-inter.woff2", "Inter-LICENSE.txt"]) cpSync(resolve(root,"outputs",file),resolve(output,"outputs",file));
