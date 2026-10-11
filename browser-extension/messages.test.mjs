// Locale checks, and the English message lookup the other extension tests use
// in place of chrome.i18n.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspectPrompt } from './engine/scanner.js';

const root = new URL('./', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const locales = ['en', 'it', 'es', 'fr', 'de'];
const bundles = Object.fromEntries(locales.map(locale => [locale, JSON.parse(read(`_locales/${locale}/messages.json`))]));

export function getMessage(key, substitutions, locale = 'en') {
  const entry = bundles[locale][key];
  const values = [].concat(substitutions ?? []);
  return entry ? entry.message.replace(/\$(\w+)\$/g, (_, name) => entry.placeholders?.[name.toLowerCase()]?.content ?? '')
    .replace(/\$(\d)/g, (_, i) => values[i - 1] ?? '') : '';
}

assert.deepEqual(fs.readdirSync(new URL('_locales/', root)).sort(), [...locales].sort(), 'Exactly en, it, es, fr and de');
const manifest = JSON.parse(read('manifest.json'));
assert.equal(manifest.default_locale, 'en');
const english = Object.keys(bundles.en).sort();
for (const locale of locales) {
  const messages = bundles[locale];
  assert.deepEqual(Object.keys(messages).sort(), english, `${locale}: same keys as English`);
  for (const [key, { message, placeholders }] of Object.entries(messages)) {
    assert.ok(message.trim(), `${locale}.${key} is empty`);
    assert.deepEqual(Object.keys(placeholders ?? {}), Object.keys(bundles.en[key].placeholders ?? {}), `${locale}.${key}: placeholders`);
    for (const name of message.match(/\$(\w+)\$/g) ?? []) assert.ok(placeholders?.[name.slice(1, -1).toLowerCase()], `${locale}.${key}: ${name} undeclared`);
    // Owner rules and store policy: no retired site, no old backend, no promise of private repositories.
    assert.doesNotMatch(message, /copilot|promptshield|illustrat|private repositor|guarantee[ds]? (?:to|that)|100 ?%/i, `${locale}.${key}`);
  }
  assert.ok([...messages.extName.message].length <= 75, `${locale}: store name ≤ 75 characters`);
  assert.ok([...messages.extDescription.message].length <= 132, `${locale}: summary ≤ 132 characters`);
  assert.equal(messages.locale.message, locale);
  // The example shows the headline cases: an API key, an email and a card.
  const kinds = new Set(inspectPrompt(messages.exampleText.message).findings.map(f => f.kind));
  for (const kind of ['secret', 'email', 'card']) assert.ok(kinds.has(kind), `${locale}: example finds ${kind}`);
}

// Every key the code asks for exists.
const used = new Set();
for (const file of ['shared.js', 'popup.js', 'content.js', 'background.js']) {
  for (const [, key] of read(file).matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) used.add(key);
  for (const [, key] of read(file).matchAll(/:\s*"((?:resp|policy)[A-Za-z]+)"/g)) used.add(key);
}
for (const [, key] of read('popup.html').matchAll(/data-i18n(?:-placeholder|-label)?="([^"]+)"/g)) used.add(key);
for (const [, key] of read('manifest.json').matchAll(/__MSG_(\w+)__/g)) used.add(key);
for (const kind of ['email', 'ssn', 'name', 'address', 'secret', 'privateKey', 'card', 'crypto', 'iban', 'fiscalCode', 'phone', 'ip', 'credential', 'custom']) used.add(`kind_${kind}`);
for (const key of used) assert.ok(bundles.en[key], `Missing message: ${key}`);
assert.ok(used.size > 100);
if (process.argv[1]?.endsWith("messages.test.mjs")) console.log(`Locales: ${locales.length} languages, ${english.length} messages each, placeholders, store limits and ${used.size} used keys passed.`);
