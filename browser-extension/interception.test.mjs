import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getMessage } from './messages.test.mjs';

const listeners = new Map(), controls = new Map(), callbacks = [], dispatched = [], toasts = [];
let onRuntimeMessage;
const composer = { value: 'Synthetic private prompt', contains: node => node === composer, focus() {}, dispatchEvent(e) { dispatched.push(e); } };
const button = { disabled: false, click() {}, matches: selector => selector.includes('send-button') };
let modal, scans = 0;
const context = vm.createContext({
  setTimeout() {},
  document: { body: null, getElementById: () => null, addEventListener(type, handler) { listeners.set(type, handler); },
    querySelector(selector) { return selector === '#prompt-textarea' ? composer : selector.includes('send-button') ? button : null; },
    createElement() { return { innerHTML: '', remove() {}, setAttribute() {}, querySelector(selector) {
      return { addEventListener(_type, handler) { controls.set(selector, handler); } };
    } }; } },
  window: { setInterval() {}, setTimeout() {}, clearTimeout() {} },
  KeyboardEvent: class { constructor(type, init) { Object.assign(this, init, { type }); } },
  chrome: { i18n: { getMessage }, runtime: { id: 'test-extension', onMessage: { addListener(handler) { onRuntimeMessage = handler; } }, sendMessage(message, callback) {
    if (message.type === 'SCAN') scans++;
    callbacks.push({ message, callback });
  } } }
});
vm.runInContext(fs.readFileSync(new URL('shared.js', import.meta.url), 'utf8'), context);
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
// Visitors and accounts without a plan are checked too, on their device.
for (const status of [{ signedIn: false }, { signedIn: true, active: false }]) {
  const next = vm.runInContext('refreshStatus()', context);
  callbacks.shift().callback({ ok: true, result: status });
  await next;
  assert.equal(event('keydown'), true, 'Free users get the automatic check before sending');
  await drain();
  const local = callbacks.shift();
  assert.equal(local.message.type, 'SCAN');
  assert.equal(local.message.requireAccount, false, 'Free automatic checks run locally');
  local.callback({ ok: true, result: { findings: [], redactedText: composer.value, decision: { action: 'allow' }, engine: 'local' } });
  await drain();
  // A clean check re-sends the message; in a browser that re-dispatched event consumes the bypass.
  assert.equal(vm.runInContext('bypassArm', context), true, 'A clean check sends the prompt');
  vm.runInContext('bypassArm = false', context);
}
assert.equal(scans, 3);
vm.runInContext('autoCheck = false', context);
assert.equal(event('keydown'), false, 'Switching automatic checks off restores ordinary send');
assert.equal(event('click'), false);
vm.runInContext('autoCheck = true', context);
const active = vm.runInContext('refreshStatus()', context);
callbacks.shift().callback({ ok: true, result: { signedIn: true, active: true } });
await active;
delete context.chrome.runtime.id;
context.document.body = { append(node) { toasts.push(node.textContent); } };
assert.equal(event('keydown'), false, 'A script orphaned by an extension update no longer holds sends');
assert.equal(event('click'), false);
assert.deepEqual(toasts, [getMessage('reloadAfterUpdate')], 'An orphaned tab says once that it needs a reload');
context.chrome.runtime.id = 'test-extension';
context.document.body = { append(node) { modal = node; } };

// The automatic-check switch arrives with STATUS (no storage access in pages),
// and the popup's change is pushed to open tabs.
const switched = vm.runInContext('refreshStatus()', context);
callbacks.shift().callback({ ok: true, result: { signedIn: false, autoCheck: false } });
await switched;
assert.equal(event('keydown'), false, 'Switched off in the popup: ordinary send');
onRuntimeMessage({ type: 'SETTINGS_CHANGED' }, { id: 'test-extension' });
callbacks.shift().callback({ ok: true, result: { signedIn: false, autoCheck: true } });
await drain();
assert.equal(vm.runInContext('autoCheck', context), true, 'Switched back on without reloading the tab');
onRuntimeMessage({ type: 'SETTINGS_CHANGED' }, { id: 'another-extension' });
assert.equal(callbacks.length, 0, 'Only this extension can push a settings change');

// Ctrl+Enter is re-sent as Ctrl+Enter: a site set to send with it would read a bare Enter as a new line.
{
  let stopped = false;
  listeners.get('keydown')({ key: 'Enter', ctrlKey: true, target: composer, preventDefault() { stopped = true; }, stopImmediatePropagation() {} });
  assert.equal(stopped, true);
  await drain();
  const scan = callbacks.shift();
  assert.equal(scan.message.type, 'SCAN');
  scan.callback({ ok: true, result: { findings: [], redactedText: composer.value, decision: { action: 'allow' }, engine: 'local' } });
  await drain();
  const resent = dispatched.filter(e => e.type === 'keydown').at(-1);
  assert.equal(resent.ctrlKey, true, 'modifier kept on the re-sent Enter');
  vm.runInContext('bypassArm = false', context);
}
// Send buttons are recognized by structure, so a translated label is still held;
// other buttons and ChatGPT's stop state are left alone.
const clickOn = target => {
  let stopped = false;
  listeners.get('click')({ target: { closest: () => target }, preventDefault() { stopped = true; }, stopImmediatePropagation() { stopped = true; } });
  return stopped;
};
const submit = (label, extra = {}) => ({ disabled: false, click() {}, dataset: { stopLabel: 'Interrompi generazione' }, getAttribute: () => label, matches: selector => selector === 'button[data-composer-submit]', ...extra });
assert.equal(clickOn({ disabled: false, click() {}, matches: () => false }), false, 'Other buttons are left alone');
assert.equal(clickOn(submit('Interrompi generazione')), false, 'Stopping a reply is not a send');
assert.equal(clickOn(submit('Invia messaggio', { matches: () => { throw new SyntaxError('unsupported'); } })), false, 'An unparseable selector never throws');
assert.equal(clickOn(submit('Invia messaggio')), true, 'A send button with a translated label is still checked');
console.log('Interception: initial status, duplicate actions, account/scan outages, free local checks, the off switch (pushed to open tabs), Ctrl+Enter, the update notice and translated send buttons passed.');
