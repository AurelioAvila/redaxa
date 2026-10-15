import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { inspectPrompt } from './engine/scanner.js';
import { defaultPersonalPolicy, evaluatePolicy } from './engine/policy.js';
import { getMessage } from './messages.test.mjs';
const root = new URL('./', import.meta.url);
let account = { active: true, plan: 'personal', status: 'active' };
let session = { email: 'fixture@example.test', access_token: 'nonworking-test-token', refresh_token: 'fixture', expires_at: Date.now() + 3600000 };
let stored = {};
const opened = [], requests = [];
let installed, accessLevel, storageChanged;
const pushed = [];
let calls = 0;
const context = vm.createContext({ URL, AbortController, AbortSignal, setTimeout, clearTimeout, console, inspectPrompt, defaultPersonalPolicy, evaluatePolicy,
  fetch: async (url) => { calls++; requests.push(url); return { ok: true, json: async () => account }; },
  chrome: { storage: { onChanged: { addListener(handler) { storageChanged = handler; } }, local: {
      setAccessLevel: async value => { accessLevel = value.accessLevel; },
      get: async key => key === 'redaxa_session' ? { redaxa_session: session } : { [key]: stored[key] },
      set: async value => { if ('redaxa_session' in value) session = value.redaxa_session; else Object.assign(stored, value); },
      remove: async () => { session = null; } } },
    tabs: { create: async value => { opened.push(value); }, query: async () => [{ id: 1 }, { id: 2 }],
      sendMessage: async (id, message) => { pushed.push([id, message.type]); if (id === 2) throw new Error('No content script'); } },
    i18n: { getMessage },
    runtime: { id: 'fixture-id', getURL: path => `chrome-extension://fixture-id/${path}`, onMessage: { addListener() {} }, onInstalled: { addListener(handler) { installed = handler; } } }
  }
});
vm.runInContext(fs.readFileSync(new URL('config.js', root), 'utf8'), context);
// The worker is an ES module; its imports are supplied above.
vm.runInContext(fs.readFileSync(new URL('background.js', root), 'utf8').replace(/^import .*;\r?\n/gm, ''), context);
const handle = vm.runInContext('handleMessage', context);
const entitlement = vm.runInContext('repositoryEntitlement', context);
const popup = { url: 'chrome-extension://fixture-id/popup.html' };
const welcomeTab = { url: 'chrome-extension://fixture-id/popup.html?welcome', tab: { url: 'chrome-extension://fixture-id/popup.html?welcome' } };
const chatgpt = { url: 'https://chatgpt.com/c/1', tab: { url: 'https://chatgpt.com/c/1' } };

// Permissions: storage and clipboard only, no host access, the four AI sites.
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
assert.deepEqual(manifest.permissions, ['storage', 'clipboardWrite']);
assert.equal(manifest.host_permissions, undefined, 'No host permissions: the API answers extension origins over CORS');
assert.equal(manifest.optional_permissions, undefined);
assert.deepEqual(manifest.content_scripts[0].matches, ['https://chatgpt.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*', 'https://www.perplexity.ai/*']);
assert.equal(manifest.externally_connectable, undefined);
assert.equal(manifest.web_accessible_resources, undefined);
assert.equal(manifest.content_security_policy, undefined, 'Manifest V3 default CSP: script-src self, no remote code');
for (const size of ['16', '32', '48', '128']) assert.ok(fs.existsSync(new URL(manifest.icons[size], root)), `icon ${size}`);
for (const file of fs.readdirSync(root).filter(name => /\.(js|html)$/.test(name)).concat(fs.readdirSync(new URL('engine/', root)).map(name => `engine/${name}`))) {
  const code = fs.readFileSync(new URL(file, root), 'utf8');
  assert.doesNotMatch(code, /\beval\s*\(|new Function\s*\(|importScripts\s*\(|<script[^>]+src="https?:|import\s*\(\s*["'`]https?:/, `${file}: no remote or dynamic code`);
  assert.doesNotMatch(code, /promptshield-beta|copilot/i, `${file}: no retired host or site`);
}

for (const plan of ['personal', 'pro', 'business']) assert.equal(entitlement({ active: true, status: 'active', plan }), true);
for (const state of [{ active: false, plan: 'pro', status: 'active' }, { active: true, plan: 'free', status: 'active' }, { active: true, plan: 'pro', status: 'past_due' }, { active: 'true', plan: 'pro', status: 'active' }]) assert.equal(entitlement(state), false);
assert.equal(entitlement({ active: true, repositoryAccess: true, plan: null, status: null }), true, 'verified team-member access');
assert.equal(entitlement({ active: true, repositoryAccess: false, plan: 'pro', status: 'active' }), false, 'explicit server refusal beats legacy fallback');

// First install opens the welcome tab once; updates do not.
installed({ reason: 'update' });
assert.equal(opened.length, 0);
installed({ reason: 'install' });
assert.equal(opened[0].url, 'chrome-extension://fixture-id/popup.html?welcome');

// Account actions come from the popup (or its welcome tab), never from a page.
const before = calls;
await assert.rejects(handle({ type: 'SIGN_IN', email: 'a@b.test', password: 'x' }, chatgpt), /popup/);
await assert.rejects(handle({ type: 'SIGN_OUT' }, { url: 'chrome-extension://fixture-id/popup.html.evil' }), /popup/);
assert.equal(calls, before, 'content scripts cannot start account requests');
await assert.rejects(handle({ type: 'OPEN_REPOSITORY', repository: 'https://github.com/a/b' }, popup), /Unknown message type/);
account = { active: true, repositoryAccess: true, plan: null, status: null };
const status = await handle({ type: 'STATUS' }, chatgpt);
assert.equal(status.repositoryAccess, true);
assert.equal(status.access_token, undefined);
assert.equal(status.email, undefined, 'AI-site tabs are not told the account email');
assert.equal(status.autoCheck, true, 'the automatic-check switch travels with the status');
assert.equal((await handle({ type: 'STATUS' }, popup)).email, 'fixture@example.test', 'the popup shows the account');
// The trial's end and a plan paused by a failed payment reach the popup; an account service without them changes nothing.
assert.equal(status.trialEndsAt, null);
assert.equal(status.paused, false);
account = { active: true, repositoryAccess: true, plan: 'personal', status: 'trialing', currentPeriodEnd: '2026-10-17T10:00:00.000Z', billing: { state: 'trialing', blockedReason: 'none' } };
assert.equal((await handle({ type: 'STATUS' }, popup)).trialEndsAt, '2026-10-17T10:00:00.000Z');
account = { active: false, repositoryAccess: false, plan: 'personal', status: 'past_due', billing: { state: 'blocked', blockedReason: 'payment_failed' } };
assert.equal((await handle({ type: 'STATUS' }, popup)).paused, true);
account = { active: true, repositoryAccess: true, plan: null, status: null };
// Content scripts share a process with the AI site: storage, and the session in it, stays closed to them.
assert.equal(accessLevel, 'TRUSTED_CONTEXTS');
stored.redaxa_auto_check = false;
assert.equal((await handle({ type: 'STATUS' }, chatgpt)).autoCheck, false);
delete stored.redaxa_auto_check;
storageChanged({ redaxa_auto_check: { oldValue: true, newValue: false } }, 'local');
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(pushed, [[1, 'SETTINGS_CHANGED'], [2, 'SETTINGS_CHANGED']], 'a changed switch is pushed to open tabs');
storageChanged({ redaxa_session: { oldValue: { a: 1 }, newValue: { a: 2 } } }, 'local');
storageChanged({ redaxa_helpful_checks: { newValue: 3 } }, 'local');
await new Promise(resolve => setImmediate(resolve));
assert.equal(pushed.length, 2, 'token refreshes and counters are not pushed');
assert.ok(requests.every(url => url.startsWith('https://redaxa.getcertsprint.com/api/')), 'Account calls go to the Redaxa workspace API');

session = null;
let requestHeaders;
context.fetch = async (_url, request) => {
  calls++; requestHeaders = request.headers;
  return { ok: true, json: async () => ({ findings: [], redactedText: 'Synthetic text', decision: { action: 'allow' } }) };
};
// Free use is checked on this device: no request leaves the browser.
const localCalls = calls;
const secret = 'ghp_' + 'SYNTHETICdoNotUse0123456789abcdefABCD';
const scan = await handle({ type: 'SCAN', text: `Deploy with token ${secret} for maria.rossi@company.io` }, popup);
assert.equal(scan.engine, 'local');
assert.equal(calls, localCalls, 'a free check sends nothing');
assert.ok(scan.findings.some(f => f.kind === 'secret') && scan.findings.some(f => f.kind === 'email'));
assert.ok(!scan.redactedText.includes(secret) && !scan.redactedText.includes('maria.rossi@company.io'));
assert.equal(scan.decision.action, 'redact', 'the default personal policy applies locally (credentials: redact)');
const clean = await handle({ type: 'SCAN', text: 'Synthetic text' }, popup);
assert.equal(clean.redactedText, 'Synthetic text'); assert.equal(clean.findings.length, 0);
assert.equal(requestHeaders, undefined);
const optionsOnly = await handle({ type: 'SCAN', text: 'Call maria.rossi@company.io', options: { includePersonalData: false, customTerms: ['x'] } }, popup);
assert.equal(optionsOnly.findings.length, 0, 'category switches are honoured; other options are ignored');

// The review prompt counts helpful checks on AI sites only, as a bare number.
await new Promise(resolve => setImmediate(resolve));
assert.equal(stored.redaxa_helpful_checks, undefined, 'popup checks are not counted');
await handle({ type: 'SCAN', text: 'mail maria.rossi@company.io' }, welcomeTab);
await handle({ type: 'SCAN', text: 'nothing here' }, chatgpt);
await handle({ type: 'SCAN', text: 'mail maria.rossi@company.io' }, chatgpt);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(stored, { redaxa_helpful_checks: 1 }, 'one helpful AI-site check, and nothing else stored');
assert.equal(calls, localCalls, 'still nothing sent');

const beforeAutomatic = calls;
await assert.rejects(handle({ type: 'SCAN', text: 'Synthetic text', requireAccount: true }, popup), /Sign in again/);
assert.equal(calls, beforeAutomatic, 'Expired automatic access cannot fall back to guest quota');
const scanCalls = calls;
for (const text of ['', ' ', null, 'x'.repeat(20001)]) await assert.rejects(handle({ type: 'SCAN', text }, popup), /characters/);
assert.equal(calls, scanCalls, 'Invalid input never consumes quota');
session = { email: 'fixture@example.test', access_token: 'fixture', expires_at: Date.now() + 3600000 };
context.fetch = async (_url, request) => {
  requestHeaders = request.headers;
  return { ok: false, status: 402, json: async () => ({ error: 'TRIAL_REQUIRED' }) };
};
await assert.rejects(handle({ type: 'SCAN', text: 'Synthetic text', requireAccount: true }, popup), /TRIAL_REQUIRED/);
assert.equal(requestHeaders.Authorization, 'Bearer fixture', 'An account check is authenticated and never anonymous');
context.fetch = async () => ({ ok: true, json: async () => ({}) });
await assert.rejects(handle({ type: 'SCAN', text: 'Synthetic text', requireAccount: true }, popup), /incomplete result/);
// This computer's clock a day behind: the token looks fresh here but the API
// refuses it, so the server is asked once and the check retried with its token.
session = { email: 'fixture@example.test', access_token: 'stale', refresh_token: 'fixture', expires_at: Date.now() + 86_400_000 };
const skewed = [];
context.fetch = async (url, request) => {
  skewed.push([url.replace(/^https?:\/\/[^/]+/, ''), request?.headers?.Authorization]);
  if (url.endsWith('/api/auth/session')) return { ok: true, status: 200, json: async () => ({ email: 'fixture@example.test', access_token: 'fresh', refresh_token: 'fresh-refresh', expires_in: 3600 }) };
  if (request.headers.Authorization === 'Bearer stale') return { ok: false, status: 401, json: async () => ({ error: 'UNAUTHORIZED' }) };
  return { ok: true, json: async () => ({ findings: [], redactedText: 'Synthetic text', decision: { action: 'allow' } }) };
};
assert.equal((await handle({ type: 'SCAN', text: 'Synthetic text', requireAccount: true }, popup)).engine, 'account');
assert.deepEqual(skewed.map(([path, auth]) => `${path} ${auth}`), ['/api/scan Bearer stale', '/api/auth/session Bearer stale', '/api/scan Bearer fresh']);
assert.equal(session.access_token, 'fresh');
// A day ahead: the token looks expired here; the server confirms it is still good and it is kept.
session = { email: 'fixture@example.test', access_token: 'still-good', refresh_token: 'fixture', expires_at: Date.now() - 86_400_000 };
skewed.length = 0;
context.fetch = async (url, request) => {
  skewed.push([url.replace(/^https?:\/\/[^/]+/, ''), request?.headers?.Authorization]);
  if (url.endsWith('/api/auth/session')) return { ok: true, status: 200, json: async () => ({ email: 'fixture@example.test' }) };
  return { ok: true, json: async () => ({ findings: [], redactedText: 'Synthetic text', decision: { action: 'allow' } }) };
};
assert.equal((await handle({ type: 'SCAN', text: 'Synthetic text', requireAccount: true }, popup)).engine, 'account');
assert.deepEqual(skewed.map(([path, auth]) => `${path} ${auth}`), ['/api/auth/session Bearer still-good', '/api/scan Bearer still-good']);
assert.equal(session.access_token, 'still-good', 'a wrong clock never signs anyone out');

session.expires_at = 0;
context.fetch = async () => ({ ok: false, status: 503 });
const unavailable = await handle({ type: 'STATUS' }, popup);
assert.equal(unavailable.signedIn, true, 'Transient auth failure keeps the account visible');
assert.equal(unavailable.active, false, 'Transient auth failure cannot unlock paid features');
console.log('Extension background: minimal permissions, no remote code, welcome tab, popup-only account actions, storage closed to pages, no email for pages, switch pushed to tabs, local checks send nothing, local review counter, authenticated account checks passed.');
