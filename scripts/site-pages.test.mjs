// Generated public pages (detection reference, localized landings) and the guides'
// worked examples, checked against the compiled engine. Runs after `npm run build`.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFacts } from "./site-generated.mjs";
import { buildDetectors } from "./site-detectors.mjs";
import { LANGUAGES, alternates, buildLanguages } from "./site-i18n.mjs";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const { inspectPrompt } = await import(new URL("dist/scanner.js", root));

// Pages that exist in public/ after build-web.mjs, for internal link checks.
const built = new Set(["", "index.html", "github.html", "api-docs.html", "privacy.html", "terms.html", "dashboard.html", "llms.txt", "llms-full.txt", "sitemap.xml",
  ...["sitemap-pages.xml", "sitemap-guides.xml"].flatMap((f) => [...read(f).matchAll(/<loc>https:\/\/redaxa\.getcertsprint\.com\/([^<]*)<\/loc>/g)].map((m) => m[1]))]);

for (const env of [{ TRIAL_ENABLED: "true" }, {}]) {
  const facts = readFacts(root, env);
  const detectors = await buildDetectors(root, facts);
  const languages = await buildLanguages(root, facts);
  const files = [...detectors.files, ...languages.files];
  for (const f of files) built.add(f.path.replace(/index\.html$/, ""));
  assert.ok(detectors.pages.length >= 30, "one page per detector");
  const titles = new Set();
  const descriptions = new Set();
  for (const f of files) {
    const title = f.html.match(/<title>([^<]*)<\/title>/)[1];
    const description = f.html.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(!titles.has(title) && !descriptions.has(description), `${f.path}: duplicate title or description`);
    titles.add(title); descriptions.add(description);
    assert.ok(title.length <= 75, `${f.path}: title too long (${title.length})`);
    assert.ok(description.length >= 90 && description.length <= 200, `${f.path}: description length ${description.length}`);
    assert.equal(f.html.match(/<link rel="canonical" href="([^"]+)">/)[1], f.url);
    assert.equal((f.html.match(/<h1>/g) ?? []).length, 1, `${f.path}: one h1`);
    for (const [, json] of f.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(json);
    assert.doesNotMatch(f.html, /illustrative|anti-?cheat/i, f.path);
    assert.doesNotMatch(f.html, /<!--(?:PRICE|TRIAL)|\bundefined\b|\bNaN\b|\[object /, f.path);
    for (const [, href] of f.html.matchAll(/href="(\/[^"#?]*)/g)) {
      const path = href.slice(1);
      assert.ok(built.has(path) || existsSync(new URL(path, root)) || path.startsWith("outputs/"), `${f.path}: broken internal link ${href}`);
    }
  }
  // Every generated page names the 3-day trial, switch on or off: a checkout without the choice carries it too.
  // Only the Windows app 0.5.5 and older gets seven days, and no page offers them.
  const all = files.map((f) => f.html).join("\n");
  assert.match(all, /3-day (free )?trial|prova gratuita di 3 giorni|prueba gratuita de 3 días|essai gratuit de 3 jours|Testphase von 3 Tagen/);
  assert.doesNotMatch(all, /\b7[\s-]?(day|giorn|d[ií]as?\b|jours?\b|Tage\b|tägig)|seven[- ]day/i);  // hreflang: every localized page lists all languages and x-default; the home page gets the same set at build.
  for (const f of languages.files) for (const a of alternates()) assert.ok(f.html.includes(`hreflang="${a.hreflang}" href="${a.href}"`), `${f.path}: missing ${a.hreflang}`);
  assert.equal(languages.files.length, LANGUAGES.length);
  for (const f of languages.files) assert.ok(f.html.includes(JSON.parse(read(`browser-extension/_locales/${f.code}/messages.json`)).extName.message.replace(/&/g, "&amp;")), `${f.code}: extension name differs from _locales`);
}

// The guides' worked examples are real engine output.
assert.equal(inspectPrompt('curl -H "Authorization: Bearer RedaxaDocsSampleNotRealRedaxaDocs" https://api.example.com/v1/me returns 401').redactedText,
  'curl -H "Authorization: [SECRET]" https://api.example.com/v1/me returns 401');
assert.ok(read("stop-api-keys-leaking-into-ai-prompts.html").includes('After:  curl -H "Authorization: [SECRET]" https://api.example.com/v1/me returns 401'));
assert.equal(inspectPrompt("Email the contract to maria.rossi@example.com").redactedText, "Email the contract to [EMAIL]");
// The extension facts quoted in the PII guide match the manifest that ships.
const manifest = JSON.parse(read("browser-extension/manifest.json"));
assert.deepEqual(manifest.permissions, ["storage", "clipboardWrite"]);
assert.equal(manifest.host_permissions, undefined);
assert.deepEqual(manifest.content_scripts.flatMap((c) => c.matches).sort(), ["https://chatgpt.com/*", "https://claude.ai/*", "https://gemini.google.com/*", "https://www.perplexity.ai/*"]);
console.log("Site pages: detection reference and localized pages match the engine and the product's translations.");
