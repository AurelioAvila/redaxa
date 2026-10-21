import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getMessage } from './messages.test.mjs';

const root = new URL('./', import.meta.url);
function element() {
  return { value: '', textContent: '', hidden: true, disabled: false, dataset: {}, style: {}, firstChild: {}, children: [], handlers: {},
    classList: { toggle() {}, add() {} }, setAttribute() {}, focus() {},
    replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
    addEventListener(event, handler) { this.handlers[event] = handler; }
  };
}
const markup = fs.readFileSync(new URL('popup.html', root), 'utf8');
const nodes = new Map([...markup.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
const el = id => { assert.ok(nodes.has(id), `Missing markup: ${id}`); return nodes.get(id); };
let finishScan;
let scans = 0;
let status = { signedIn: false };
const copies = [], opened = [], saved = [];
let stored = { redaxa_helpful_checks: 3 };
const context = vm.createContext({ console, URLSearchParams,
  document: { getElementById: el, querySelector: () => element(), querySelectorAll: () => [], createElement: element, documentElement: {}, body: element() },
  navigator: { clipboard: { writeText: async text => copies.push(text) } },
  chrome: { runtime: { id: 'test', sendMessage(message, done) {
    if (message.type === 'STATUS') return done({ ok: true, result: status });
    if (message.type === 'SCAN') { scans++; finishScan = done; }
  } }, tabs: { create: value => opened.push(value) }, i18n: { getMessage },
  storage: { local: { get: async () => stored, set: async value => { saved.push(value); } } } }
});
vm.runInContext(fs.readFileSync(new URL('config.js', root), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('shared.js', root), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('popup.js', root), 'utf8'), context);
const fire = (id, event = 'click') => el(id).handlers[event]({ preventDefault() {}, target: el(id) });
const tick = () => new Promise(resolve => setImmediate(resolve));
await tick();
assert.equal(el('form').hidden, false);
assert.match(el('check-access').textContent, /No account needed/);
assert.equal(scans, 0, 'Opening never reads or scans text automatically');
assert.equal(el('text-count').textContent, '0 / 20,000');
// Visible links: the Redaxa site and the Windows app, never the old backend host.
assert.equal(el('link-privacy').href, 'https://redaxa.getcertsprint.com/privacy.html');
assert.equal(el('link-windows').href, 'https://github.com/AurelioAvila/redaxa/releases/latest');
assert.ok(!nodes.has('link-repository'), 'single purpose: no repository tool in the popup');
assert.match(el('review-rate').href, /^https:\/\/chromewebstore\.google\.com\/detail\/redaxa\/clkobbjoaegkgnmkibjghlboeoplpmok\/reviews$/);
assert.doesNotMatch(markup, /promptshield|copilot|Repository tab|checks a day|github\.html/i);
// The review link appears once after three helpful checks, with no reward and an easy "Not now".
assert.equal(el('review-ask').hidden, false);
assert.equal(JSON.stringify(saved.shift()), '{"redaxa_review_prompt":"done"}', 'shown once: marked as asked when displayed');
fire('review-later');
assert.equal(el('review-ask').hidden, true);
assert.equal(JSON.stringify(saved.pop()), '{"redaxa_review_prompt":"done"}');
await fire('review-share');
assert.deepEqual(copies, ['https://chromewebstore.google.com/detail/redaxa/clkobbjoaegkgnmkibjghlboeoplpmok'], 'Sharing copies the store link only');
copies.length = 0;

fire('try-example');
assert.match(el('check-text').value, /OPENAI_API_KEY=sk-proj-.*taylor@example\.com.*4111 1111 1111 1111/);
el('check-text').value = '';
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
  { kind: 'email', label: 'Email', severity: 'medium' },
  { kind: 'privateKey', category: 'credentials', label: 'Private key', severity: 'critical' },
  { kind: 'secret', category: 'credentials', label: 'API key', severity: 'critical', credential: { service: 'GitHub', type: '<img onerror=alert(1)>', response: 'Rotate if exposed', evidence: 'Prefix only', guidance: 'Verify owner' } }
], redactedText: '[REDACTED]' } });
await pending;
assert.equal(el('check-result').hidden, false);
assert.match(el('result-heading').textContent, /credentials/);
assert.equal(el('finding-list').children[0].textContent, 'GitHub · <img onerror=alert(1)>', 'Provider labels are text, not markup');
assert.equal(el('finding-list').children[0].children[0].children[0].textContent, 'Rotate if exposed');
assert.equal(el('finding-list').children[2].textContent, 'Email address × 2', 'Repeated findings are grouped');
await fire('copy-result');
assert.deepEqual(copies, ['[REDACTED]']);
el('check-text').value = 'New unscreened content';
await fire('copy-result');
assert.equal(copies.length, 1, 'Changed text cannot reuse the previous result');
pending = fire('quick-check', 'submit');
finishScan({ ok: false, error: 'TRIAL_REQUIRED', httpStatus: 402 });
await pending;
assert.match(el('check-message').textContent, /plan could not be confirmed/);
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
assert.match(el('check-access').textContent, /workspace/);
assert.match(el('check-privacy').textContent, /workspace/);
assert.ok(nodes.has('auto-check'), 'the automatic-check switch is in the popup');
for (const id of ['welcome', 'step-enable', 'step-example', 'step-result']) assert.ok(nodes.has(id), `welcome step ${id}`);
// The free trial and a paused plan, as the account service reports them.
status = { signedIn: true, active: true, email: 'fixture@example.test', repositoryAccess: true, plan: 'personal', trialEndsAt: '2026-10-17T10:00:00.000Z', paused: false };
await vm.runInContext('render()', context);
assert.equal(el('status-plan').textContent, 'Pro trial · ends 17 October');
assert.equal(el('open-dashboard').textContent, 'Open workspace');
status = { signedIn: true, active: false, email: 'fixture@example.test', repositoryAccess: false, plan: 'personal', trialEndsAt: null, paused: true };
await vm.runInContext('render()', context);
assert.equal(el('status-pill-text').textContent, 'Payment failed');
assert.equal(el('status-plan').textContent, 'Plan paused until a payment goes through.');
assert.equal(el('open-dashboard').textContent, 'Update payment method');
fire('open-dashboard');
assert.equal(opened.at(-1).url, 'https://redaxa.getcertsprint.com/dashboard.html#workspace', 'a paused plan is fixed in Account & team');
// A switch kept on by a Business workspace or an enterprise policy is shown locked, with the reason.
el('auto-check').checked = false;
status = { signedIn: true, active: true, email: 'fixture@example.test', autoCheck: true, autoCheckLocked: true, lockedBy: 'team' };
await vm.runInContext('render()', context);
assert.equal(el('auto-check').disabled, true);
assert.equal(el('auto-check').checked, true);
assert.equal(el('auto-check-locked').hidden, false);
assert.equal(el('auto-check-locked').textContent, getMessage('autoCheckLockedTeam'));
status = { signedIn: false, autoCheck: true, autoCheckLocked: true, lockedBy: 'policy' };
await vm.runInContext('render()', context);
assert.equal(el('auto-check-locked').textContent, getMessage('autoCheckLockedAdmin'));
status = { signedIn: false, autoCheck: true, autoCheckLocked: false, lockedBy: null };
await vm.runInContext('render()', context);
assert.equal(el('auto-check').disabled, false, 'otherwise the choice is the user\'s');
assert.equal(el('auto-check-locked').hidden, true);
console.log('Popup: links, one-time review ask, example, guest check, duplicate/stale guards, grouped credential-first results, copy, plan error, clear, plan CTA, trial end, paused plan and the locked switch passed.');
