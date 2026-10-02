import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const listeners = new Map(), controls = new Map(), callbacks = [];
const composer = { value: 'Synthetic private prompt', contains: node => node === composer };
const button = { disabled: false, click() {} };
let modal, scans = 0;
const context = vm.createContext({
  document: { body: null, addEventListener(type, handler) { listeners.set(type, handler); },
    querySelector(selector) { return selector === '#prompt-textarea' ? composer : selector.includes('send-button') ? button : null; },
    createElement() { return { innerHTML: '', remove() {}, querySelector(selector) {
      return { addEventListener(_type, handler) { controls.set(selector, handler); } };
    } }; } },
  window: { setInterval() {}, setTimeout() {} },
  chrome: { runtime: { sendMessage(message, callback) {
    if (message.type === 'SCAN') scans++;
    callbacks.push({ message, callback });
  } } }
});
vm.runInContext(fs.readFileSync(new URL('content.js', import.meta.url), 'utf8'), context);
context.document.body = { append(node) { modal = node; } };
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function event(type) {
  let stopped = false;
  const e = { key: 'Enter', target: type === 'keydown' ? composer : { closest: () => button },
    preventDefault() { stopped = true; }, stopImmediatePropagation() { stopped = true; } };
  listeners.get(type)(e);
  return stopped;
}
assert.equal(event('keydown'), true, 'First Enter cannot escape before account status resolves');
assert.equal(event('click'), true, 'Repeated click is also held');
assert.equal(callbacks.length, 1, 'Concurrent sends share account status');
callbacks.shift().callback({ ok: true, result: { signedIn: true, active: true } });
await drain();
assert.equal(scans, 1, 'Repeated actions do not duplicate the pending scan');
const automatic = callbacks.shift();
assert.equal(automatic.message.requireAccount, true, 'Automatic check cannot fall back to a guest scan');
automatic.callback({ ok: false, error: 'Synthetic scan outage' });
await drain();
assert.ok(!modal.innerHTML.includes('ps-int-send-anyway'), 'Unknown policy cannot offer an unchecked bypass');
assert.match(modal.innerHTML, /not been sent/i);
const refresh = vm.runInContext('refreshStatus()', context);
callbacks.shift().callback({ ok: true, result: { signedIn: true, active: false, unavailable: true } });
await refresh;
assert.equal(event('click'), true, 'Account outage cannot silently disable protection');
await drain();
assert.equal(scans, 1, 'Account outage cannot grant paid scanning');
assert.ok(!modal.innerHTML.includes('ps-int-send-anyway'));
for (const status of [{ signedIn: false }, { signedIn: true, active: false }]) {
  const next = vm.runInContext('refreshStatus()', context);
  callbacks.shift().callback({ ok: true, result: status });
  await next;
  assert.equal(event('keydown'), false, 'Confirmed guest/inactive account retains ordinary send');
  assert.equal(event('click'), false);
}
assert.equal(scans, 1);
console.log('Interception: initial status, duplicate actions, account/scan outages and guest/inactive access passed.');
