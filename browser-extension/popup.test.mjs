import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('./', import.meta.url);
function element() {
  return { value: '', textContent: '', hidden: true, disabled: false, dataset: {}, style: {}, firstChild: {}, children: [], handlers: {},
    classList: { toggle() {} }, setAttribute() {}, focus() {},
    replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
    addEventListener(event, handler) { this.handlers[event] = handler; }
  };
}
const nodes = new Map([...fs.readFileSync(new URL('popup.html', root), 'utf8').matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
const el = id => { assert.ok(nodes.has(id), `Missing markup: ${id}`); return nodes.get(id); };
let finishScan;
let scans = 0;
let status = { signedIn: false };
const copies = [], opened = [];
const context = vm.createContext({ console,
  document: { getElementById: el, querySelector: () => element(), createElement: element },
  navigator: { clipboard: { writeText: async text => copies.push(text) } },
  chrome: { runtime: { id: 'test', sendMessage(message, done) {
    if (message.type === 'STATUS') return done({ ok: true, result: status });
    if (message.type === 'SCAN') { scans++; finishScan = done; }
  } }, tabs: { create: value => opened.push(value) } }
});
vm.runInContext(fs.readFileSync(new URL('config.js', root), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('popup.js', root), 'utf8'), context);
const fire = (id, event = 'click') => el(id).handlers[event]({ preventDefault() {} });
const tick = () => new Promise(resolve => setImmediate(resolve));
await tick();
assert.equal(el('form').hidden, false);
assert.match(el('check-access').textContent, /No account needed/);
assert.equal(scans, 0, 'Opening never reads or scans text automatically');
await fire('quick-check', 'submit');
assert.equal(scans, 0, 'Empty text does not waste server quota');
el('check-text').value = 'Synthetic review';
let pending = fire('quick-check', 'submit');
await fire('quick-check', 'submit');
assert.equal(scans, 1, 'No duplicate requests while pending');
el('check-text').value = 'Changed while pending';
fire('check-text', 'input');
finishScan({ ok: true, result: { findings: [], redactedText: 'Synthetic review' } });
await pending;
assert.equal(el('check-result').hidden, true, 'Stale response cannot be copied');
assert.equal(el('check-button').disabled, false);
pending = fire('quick-check', 'submit');
finishScan({ ok: true, result: { findings: [
  { kind: 'email', label: 'Email', severity: 'medium' },
  { kind: 'privateKey', category: 'credentials', label: 'Private key', severity: 'critical' },
  { kind: 'secret', category: 'credentials', label: 'API key', severity: 'critical', credential: { service: 'GitHub', type: '<img onerror=alert(1)>', response: 'Rotate if exposed', evidence: 'Prefix only', guidance: 'Verify owner' } }
], redactedText: '[REDACTED]' } });
await pending;
assert.equal(el('check-result').hidden, false);
assert.match(el('result-heading').textContent, /credentials/);
assert.equal(el('finding-list').children[0].textContent, 'GitHub · <img onerror=alert(1)>', 'Provider labels are text, not markup');
assert.equal(el('finding-list').children[0].children[0].children[0].textContent,'Rotate if exposed');
await fire('copy-result');
assert.deepEqual(copies, ['[REDACTED]']);
el('check-text').value = 'New unscreened content';
await fire('copy-result');
assert.equal(copies.length, 1, 'Changed text cannot reuse the previous result');
pending = fire('quick-check', 'submit');
finishScan({ ok: false, error: 'TRIAL_REQUIRED', httpStatus: 402 });
await pending;
assert.match(el('check-message').textContent, /network/);
assert.equal(el('pro-benefits').hidden, false);
fire('compare-plans');
assert.equal(new URL(opened[0].url).hash, '#plans');
assert.ok(!opened[0].url.includes('Synthetic'));
pending = fire('quick-check', 'submit');
finishScan({ ok: true, result: {} });
await pending;
assert.equal(el('check-result').hidden, true, 'Malformed result never claims no findings');
fire('clear-check');
assert.equal(el('check-text').value, '');
assert.equal(el('redacted-text').value, '');
status = { signedIn: true, active: true, email: 'fixture@example.test', repositoryAccess: true };
await vm.runInContext('render()', context);
assert.equal(el('pro-benefits').hidden, true, 'Paying customers do not get an upgrade wall');
assert.match(el('check-access').textContent, /Included/);
console.log('Popup: guest check, duplicate/stale guards, credential priority, copy, quota, clear and plan CTA passed.');
