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
console.log('SEO checks passed: nine canonical sitemap URLs; the personal workspace remains noindex; the legacy host redirects its pages.');
