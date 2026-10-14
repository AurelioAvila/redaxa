import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const entries = [...read('sitemap.xml').matchAll(/<url>\s*<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)];
assert.equal(entries.length, 9);
assert.equal(new Set(entries.map(entry => entry[1])).size, entries.length);
const origin = new URL(entries[0][1]).origin;
assert.equal(origin, 'https://redaxa.getcertsprint.com', 'Public metadata must use the verified branded domain.');
assert.ok(read('robots.txt').includes(`Sitemap: ${origin}/sitemap.xml`));
for (const [, url, modified] of entries) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, origin);
  assert.equal(parsed.protocol, 'https:');
  const html = read(parsed.pathname === '/' ? 'index.html' : parsed.pathname.slice(1));
  const canonicals = [...html.matchAll(/rel="canonical"\s+href="([^"]+)"/g)];
  assert.equal(canonicals.length, 1);
  assert.equal(canonicals[0][1], url, `${url}: canonical mismatch`);
  assert.ok(html.includes(`property="og:url" content="${url}"`), `${url}: Open Graph mismatch`);
  assert.doesNotMatch(html, /name="robots"[^>]*noindex/);
  assert.match(modified, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isFinite(Date.parse(modified)) && modified <= new Date().toISOString().slice(0, 10));
  assert.equal(new Date(modified).toISOString().slice(0, 10), modified);
}
// The repository check is a public, indexed free tool; the personal workspace is not.
for (const file of ['dashboard.html']) {
  assert.match(read(file), /name="robots"[^>]*noindex/);
  assert.ok(!entries.some(entry => entry[1].endsWith('/' + file)));
}
// The Windows app clones repositories anonymously over HTTPS (repository-full.ts), so public copy must not promise private ones.
for (const file of ['index.html', 'github.html', 'check-public-github-repo-for-leaked-api-keys.html', 'repository-ui.ts', 'README.md', 'browser-extension/popup.html', 'browser-extension/popup.js']) {
  assert.doesNotMatch(read(file).replace(/Private repositories are not supported/g, ''), /private repositories/i, `${file}: private repositories are not supported`);
}
// Derived parts: llms.txt, FAQPage JSON-LD and the verify block come from one place and must agree with the page.
const { readFacts, renderLlms, applyToIndex } = await import('./site-generated.mjs');
const facts = readFacts(new URL('../', import.meta.url));
const pkg = JSON.parse(read('package.json'));
assert.match(facts.trust.sha256, /^[0-9a-f]{64}$/);
assert.equal(facts.trust.signature.status, 'Valid');
const priced = read('index.html') + read('landing.ts');
for (const offer of facts.app.offers) {
  const shown = Number(offer.price).toLocaleString('en-US', { minimumFractionDigits: 2 });
  assert.ok(priced.includes('€' + shown) || priced.includes('€' + offer.price), 'JSON-LD offer ' + offer.name + ' (' + offer.price + ') is not a price shown on the page');
}
assert.ok(facts.faq.length >= 5, 'visible FAQ not found');
const rendered = renderLlms(facts);
assert.ok(rendered.llms.includes(facts.trust.sha256) && rendered.llms.includes('Windows desktop app ' + pkg.version));
assert.doesNotMatch(rendered.full, /illustrative|anti-?cheat/i);
const built = applyToIndex(read('index.html'), facts);
assert.ok(built.includes('"softwareVersion": "' + pkg.version + '"') && built.includes(facts.trust.sha256) && built.includes('"@type":"FAQPage"') && !built.includes('RELEASE_TRUST'));
console.log('SEO checks passed: nine canonical sitemap URLs; the personal workspace remains noindex.');
