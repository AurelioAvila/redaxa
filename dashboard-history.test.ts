import assert from 'node:assert/strict';
import { readHistory, saveHistory } from './dashboard.js';

const data = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); },
  removeItem: (key: string) => { data.delete(key); }
}});
const key = 'redaxa.personal-history.v1';
saveHistory('Private client information: client@company.tld, secret=not-for-storage', []);
assert.equal(readHistory().length, 1);
assert.doesNotMatch(data.get(key)!, /client@|not-for-storage|Private client/);

data.set(key, JSON.stringify([
  { id: 'legacy', createdAt: '2026-09-20T10:00:00Z', findings: 2, preview: 'legacy-sensitive@example.org', sourceText: 'secret-raw', byKind: { email: 1, '<img src=x onerror=alert(1)>': 1, '__proto__': 99, secret: 'invalid' } },
  { id: 'invalid-date', createdAt: 'invalid', findings: 1, byKind: { email: 1 } },
  { id: 'invalid-count', createdAt: '2026-09-20', findings: '<script>', byKind: {} },
  null
]));
const migrated = readHistory();
assert.equal(migrated.length, 1);
assert.deepEqual(migrated[0].byKind, { email: 1 });
for (const discarded of ['legacy-sensitive', 'secret-raw', '<img', '<script>', 'sourceText']) {
  assert.equal(data.get(key)!.includes(discarded), false);
}
assert.equal(migrated[0].preview, 'Prompt content is not stored.');

data.set(key, JSON.stringify(Array.from({length: 80}, (_, i) => ({ id: String(i), createdAt: '2026-09-20', findings: 0, preview: 'do-not-retain', byKind: {} }))));
assert.equal(readHistory().length, 40);
assert.doesNotMatch(data.get(key)!, /do-not-retain/);
data.set(key, '{malformed-private-content');
assert.deepEqual(readHistory(), []);
assert.equal(data.has(key), false);
console.log('Dashboard history stores metadata only, migrates legacy prompt previews and rejects unsafe or invalid entries.');
