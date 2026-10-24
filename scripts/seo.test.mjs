import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
// Hand-maintained silos; /sitemap.xml is the index build-web.mjs writes over them and the generated silos.
const entries = ['sitemap-pages.xml', 'sitemap-guides.xml'].flatMap(file => [...read(file).matchAll(/<url>\s*<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)]);
assert.equal(entries.length, 11);
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
// Guides: no hand-typed prices or trial lengths; markers are filled at build from the offers and the switch.
const { applyMarkers } = await import('./site-generated.mjs');
const guides = entries.map(([, url]) => new URL(url).pathname.slice(1)).filter(path => path.endsWith('.html') && !['github.html', 'api-docs.html', 'privacy.html', 'terms.html'].includes(path));
assert.equal(guides.length, 6);
for (const env of [{ TRIAL_ENABLED: 'true' }, {}]) {
  const f = readFacts(new URL('../', import.meta.url), env);
  assert.equal(f.trial.enabled, env.TRIAL_ENABLED === 'true');
  assert.match(f.trial.short, env.TRIAL_ENABLED ? /3-day free trial/ : /3-day trial/);
  if (env.TRIAL_ENABLED) assert.match(f.trial.long, /payment fails, the plan is paused/);
  for (const file of guides) {
    const source = read(file);
    assert.doesNotMatch(source.split(/<!--(?:PRICE:[^>]*|TRIAL|TRIAL_LONG)-->/).join(' '), /€\s?\d|\d+-day trial/, `${file}: prices and trial lengths come from markers`);
    const html = applyMarkers(source, f);
    assert.doesNotMatch(html, /<!--(?:PRICE|TRIAL)/);
    assert.doesNotMatch(html, /illustrative/i);
  }
  const index = applyToIndex(read('index.html'), f);
  assert.equal(index.includes('data-legacy-copy'), f.trial.enabled, 'the build writes the live trial wording into the page');
  assert.equal(/How does the 3-day trial work\?/.test(index.replace(/data-[a-z-]+="[^"]*"/g, '')), f.trial.enabled);
}
// FAQPage markup on every static page: a real question with a non-empty answer that is visible on the page.
for (const file of [...guides, 'github.html', 'api-docs.html']) {
  const html = read(file);
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const data = JSON.parse(json);
    const nodes = data['@graph'] ?? [data];
    for (const faq of nodes.filter(n => n['@type'] === 'FAQPage')) for (const q of faq.mainEntity) {
      assert.ok(q.name && q.acceptedAnswer?.text, `${file}: empty FAQ entry`);
      assert.doesNotMatch(q.name, /\]\(|\*\*/, `${file}: markdown in FAQ`);
      assert.ok(html.includes(q.name) || html.includes(q.name.replace(/'/g, '&#39;')), `${file}: FAQ question not on the page: ${q.name}`);
    }
  }
  assert.doesNotMatch(html, /\]\(https?:|\*\*\s/, `${file}: stray markdown`);
}
// The legacy Vercel host moves its pages to the branded domain with a permanent
// redirect, so Search Console stops reporting them as noindex duplicates.
// Released desktop and extension builds still call its /api, which must stay.
{
  const vercel = JSON.parse(read('vercel.json'));
  const legacy = (vercel.redirects ?? []).filter(rule => rule.has?.some(h => h.type === 'host' && h.value === 'promptshield-beta.vercel.app'));
  assert.ok(legacy.length >= 1 && legacy.every(rule => rule.permanent === true && rule.destination.startsWith(origin + '/')));
  const pagePattern = legacy.find(rule => rule.source.includes(':path'));
  const regex = new RegExp('^/(' + pagePattern.source.slice('/:path('.length, -1) + ')$');
  for (const page of ['/privacy.html', '/dashboard.html', '/sitemap.xml']) assert.ok(regex.test(page), page);
  for (const api of ['/api/account', '/api/auth/session', '/api/billing']) assert.ok(!regex.test(api), api);
}
console.log('SEO checks passed: eleven canonical sitemap URLs in two silos; guides take prices and the trial from the build; FAQ markup matches the pages; the personal workspace remains noindex; the legacy host redirects its pages.');
