import assert from 'node:assert/strict';
import { coffeeUrl, cryptoCoffeeCents } from '../dist/desktop.js';

// The card tip keeps its link; the crypto one only adds method=crypto.
assert.equal(coffeeUrl(3), 'https://api.pctweaker.app/api/tip/start?product=redaxa&quantity=3');
assert.equal(coffeeUrl(3, 'crypto'), 'https://api.pctweaker.app/api/tip/start?product=redaxa&quantity=3&method=crypto');
assert.equal(coffeeUrl(99, 'crypto'), 'https://api.pctweaker.app/api/tip/start?product=redaxa&quantity=10&method=crypto');

// The choice appears only when the shared API says crypto is available, with a sane price.
const original = globalThis.fetch;
const answer = (body, ok = true) => { globalThis.fetch = async () => ({ ok, json: async () => body }); };
try {
  answer({ crypto: { available: true, coffee: { usd: 133 }, country: 'IT' } });
  assert.equal(await cryptoCoffeeCents(), 133);
  for (const body of [{ crypto: { available: false } }, {}, { crypto: { available: true } }, { crypto: { available: 'true', coffee: { usd: 133 } } }, { crypto: { available: true, coffee: { usd: 1.5 } } }, { crypto: { available: true, coffee: { usd: -1 } } }]) {
    answer(body);
    assert.equal(await cryptoCoffeeCents(), null, JSON.stringify(body));
  }
  answer({ crypto: { available: true, coffee: { usd: 133 } } }, false);
  assert.equal(await cryptoCoffeeCents(), null, 'an error status hides it');
  globalThis.fetch = async () => { throw new TypeError('CORS'); };
  assert.equal(await cryptoCoffeeCents(), null, 'a refused or failed call hides it');
} finally { globalThis.fetch = original; }
console.log('Coffee in crypto: link, availability gate and every failure hidden passed.');
