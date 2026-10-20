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
// The account check fails without an answer (network, timeout): a plan outside a
// Business workspace is checked on this device instead, and says so.
automatic.callback({ ok: false, error: 'Synthetic scan outage' });
await drain();
const fallback = callbacks.shift();
assert.equal(fallback.message.type, 'SCAN');
assert.equal(fallback.message.requireAccount, false, 'An account-check outage falls back to the check on this device');
fallback.callback({ ok: true, result: { findings: [], redactedText: composer.value, decision: { action: 'allow' }, engine: 'local' } });
await drain();
assert.equal(vm.runInContext('bypassArm', context), true, 'A clean fallback check sends');
assert.equal(modal.textContent, getMessage('checkedLocallyOutage'), 'and says protected terms and team rules were not applied');
vm.runInContext('bypassArm = false', context);
// A refusal is an answer: it stands.
assert.equal(event('keydown'), true);
await drain();
callbacks.shift().callback({ ok: false, error: 'TRIAL_REQUIRED', httpStatus: 402 });
await drain();
assert.ok(!modal.innerHTML.includes('ps-int-send-anyway'), 'A plan refusal cannot offer an unchecked bypass');
assert.match(modal.innerHTML, /not been sent/i);
assert.equal(scans, 3);
// A Business workspace member may have team rules that block: an outage holds the send.
let refresh = vm.runInContext('refreshStatus()', context);
callbacks.shift().callback({ ok: true, result: { signedIn: true, active: true, orgManaged: true } });
await refresh;
assert.equal(event('keydown'), true);
await drain();
callbacks.shift().callback({ ok: false, error: 'Synthetic scan outage' });
await drain();
assert.equal(callbacks.length, 0, 'No local fallback for a workspace member');
assert.ok(!modal.innerHTML.includes('ps-int-send-anyway'), 'Unknown team policy cannot offer an unchecked bypass');
refresh = vm.runInContext('refreshStatus()', context);
callbacks.shift().callback({ ok: true, result: { signedIn: true, active: false, unavailable: true, orgManaged: true } });
await refresh;
assert.equal(event('click'), true, 'Account outage cannot silently disable protection');
await drain();
assert.equal(scans, 4, 'Account outage cannot grant paid scanning');
assert.ok(!modal.innerHTML.includes('ps-int-send-anyway'));
assert.match(modal.innerHTML, /could not verify/i);
// Outside a workspace, an unreachable account is checked on this device.
refresh = vm.runInContext('refreshStatus()', context);
callbacks.shift().callback({ ok: true, result: { signedIn: true, active: false, unavailable: true } });
await refresh;
assert.equal(event('keydown'), true);
await drain();
const outageScan = callbacks.shift();
assert.equal(outageScan.message.requireAccount, false, 'An account outage outside a workspace never blocks every send');
outageScan.callback({ ok: true, result: { findings: [], redactedText: composer.value, decision: { action: 'allow' }, engine: 'local' } });
await drain();
assert.equal(vm.runInContext('bypassArm', context), true);
vm.runInContext('bypassArm = false', context);
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
assert.equal(scans, 7);
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
// Editing an earlier message: its own box is checked on conversation pages
// by the last button beside it (Save/Send/Update after Cancel). Enter there
// is left alone: it may be a new line, which a re-sent Enter would not insert.
{
  // Settle the check the translated send button started.
  await drain();
  callbacks.shift().callback({ ok: true, result: { findings: [], redactedText: composer.value, decision: { action: 'allow' }, engine: 'local' } });
  await drain();
  vm.runInContext('bypassArm = false', context);
  const fresh = vm.runInContext('refreshStatus()', context);
  callbacks.shift().callback({ ok: true, result: { signedIn: false, autoCheck: true } });
  await fresh;
  const editable = "textarea, [contenteditable='true'], [contenteditable='plaintext-only']";
  let inDialog = false;
  const editBox = { value: 'Edited: deploy key ghp_SYNTHETIC', offsetHeight: 40, focus() {}, dispatchEvent(e) { dispatched.push({ ...e, on: 'edit' }); },
    contains: node => node === editBox, closest: selector => selector === editable ? editBox : inDialog ? {} : null };
  const press = () => { let stopped = false; listeners.get('keydown')({ key: 'Enter', target: editBox, preventDefault() { stopped = true; }, stopImmediatePropagation() {} }); return stopped; };
  context.location = { pathname: '/settings' };
  assert.equal(press(), false, 'Text areas outside conversations keep Enter as a new line');
  context.location = { pathname: '/c/abc' };
  inDialog = true;
  assert.equal(press(), false, 'Dialog text areas (custom instructions) are left alone');
  inDialog = false;
  assert.equal(press(), false, 'Enter in an edit box keeps its own meaning (it may be a new line)');
  const cancel = { disabled: false, click() {}, matches: () => false };
  const save = { disabled: false, click() {}, matches: () => false };
  const container = { parentElement: null, contains: node => node === editBox,
    querySelectorAll: selector => selector === 'button' ? [cancel, save] : [editBox] };
  cancel.parentElement = save.parentElement = container;
  assert.equal(clickOn(cancel), false, 'Cancel next to an edit box is not a send');
  assert.equal(clickOn(save), true, 'Save after Cancel sends the edited message, whatever its label');
  await drain();
  const saveScan = callbacks.shift();
  assert.equal(saveScan.message.text, editBox.value);
  saveScan.callback({ ok: true, result: { findings: [], redactedText: editBox.value, decision: { action: 'allow' }, engine: 'local' } });
  await drain();
  vm.runInContext('bypassArm = false', context);
  context.location = undefined;
}

// Attachments: text files are checked on this device when dropped, pasted or
// chosen; uploads are never blocked, but a finding holds the next send.
{
  const file = (name, text, extra = {}) => ({ name, size: text.length, type: '', text: async () => text, ...extra });
  const finding = { kind: 'credential', category: 'credentials', severity: 'critical', label: 'Secret in a configuration value' };
  listeners.get('drop')({ dataTransfer: { files: [file('.env', 'DB_PASSWORD=Sup3rSecretValue'), file('scan.pdf', '%PDF', { type: 'application/pdf' }), file('big.log', 'x', { size: 2_000_000 })] } });
  await drain();
  const fileScan = callbacks.shift();
  assert.equal(fileScan.message.requireAccount, false, 'Attachments are checked on this device only');
  assert.equal(fileScan.message.text, 'DB_PASSWORD=Sup3rSecretValue');
  assert.equal(callbacks.length, 0, 'Binary and oversized files are not read');
  fileScan.callback({ ok: true, result: { findings: [finding], redactedText: '', decision: null, engine: 'local' } });
  await drain();
  assert.equal(modal.textContent, getMessage('attachFoundToast', ['.env', getMessage('kind_credential')]));
  const prompt = composer.value;
  composer.value = '';
  assert.equal(event('keydown'), true, 'A flagged attachment holds a send with no text');
  await drain();
  assert.match(modal.innerHTML, /\.env/);
  assert.ok(modal.innerHTML.includes(getMessage('attachTitle')));
  assert.ok(modal.innerHTML.includes('scan.pdf') && modal.innerHTML.includes('big.log'), 'Files that were not inspected are named');
  assert.ok(modal.innerHTML.includes('ps-int-send-anyway'));
  controls.get('#ps-int-send-anyway')();
  assert.equal(vm.runInContext('bypassArm', context), true, 'Send anyway sends');
  vm.runInContext('bypassArm = false', context);
  assert.equal(event('keydown'), false, 'Confirmed once: nothing left to hold');
  listeners.get('change')({ target: { type: 'file', files: [file('notes.txt', 'hello')] } });
  await drain();
  callbacks.shift().callback({ ok: true, result: { findings: [], redactedText: 'hello', decision: null, engine: 'local' } });
  await drain();
  assert.equal(event('keydown'), false, 'A clean attachment holds nothing');
  vm.runInContext('autoCheck = false', context);
  listeners.get('paste')({ clipboardData: { files: [file('.env', 'TOKEN=abcdefgh12345')] } });
  await drain();
  assert.equal(callbacks.length, 0, 'Automatic checks off: attachments are not read');
  vm.runInContext('autoCheck = true', context);
  composer.value = prompt;
}
console.log('Interception: initial status, duplicate actions, account/scan outages, free local checks, the off switch (pushed to open tabs), Ctrl+Enter, the update notice, translated send buttons, edit boxes and attachments passed.');
