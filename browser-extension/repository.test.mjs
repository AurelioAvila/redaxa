import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { inspectPrompt } from './engine/scanner.js';
import { defaultPersonalPolicy, evaluatePolicy } from './engine/policy.js';
const root = new URL('./', import.meta.url);
let account = { active: true, plan: 'personal', status: 'active' };
let session = { email: 'fixture@example.test', access_token: 'nonworking-test-token', refresh_token: 'fixture', expires_at: Date.now() + 3600000 };
const opened = [];
let calls = 0;
const context = vm.createContext({ URL, AbortController, AbortSignal, setTimeout, clearTimeout, console, inspectPrompt, defaultPersonalPolicy, evaluatePolicy,
  fetch: async () => { calls++; return { ok: true, json: async () => account }; },
  chrome: { storage: { local: { get: async () => ({ redaxa_session: session }), set: async value => { session = value.redaxa_session; }, remove: async () => { session = null; } } },
    tabs: { create: async value => { opened.push(value); } },
    runtime: { id: 'fixture-id', getURL: path => `chrome-extension://fixture-id/${path}`, onMessage: { addListener() {} } }
  }
});
vm.runInContext(fs.readFileSync(new URL('config.js', root), 'utf8'), context);
// The worker is an ES module; its imports are supplied above.
vm.runInContext(fs.readFileSync(new URL('background.js', root), 'utf8').replace(/^import .*;\r?\n/gm, ''), context);
const handle = vm.runInContext('handleMessage', context);
const entitlement = vm.runInContext('repositoryEntitlement', context);
const parse = vm.runInContext('repositoryURL', context);
const popup = { url: 'chrome-extension://fixture-id/popup.html' };
const message = { type: 'OPEN_REPOSITORY', repository: 'https://github.com/Example/repository.git' };
for (const plan of ['personal', 'pro', 'business']) assert.equal(entitlement({ active: true, status: 'active', plan }), true);
for (const state of [{ active: false, plan: 'pro', status: 'active' }, { active: true, plan: 'free', status: 'active' }, { active: true, plan: 'pro', status: 'past_due' }, { active: 'true', plan: 'pro', status: 'active' }]) assert.equal(entitlement(state), false);
assert.equal(entitlement({ active: true, repositoryAccess: true, plan: null, status: null }), true, 'verified team-member access');
assert.equal(entitlement({ active: true, repositoryAccess: false, plan: 'pro', status: 'active' }), false, 'explicit server refusal beats legacy fallback');
for (const url of ['http://github.com/a/b', 'https://github.com/a/b/tree/main', 'https://github.com@evil.example/a/b', 'https://github.com/a/b?token=secret', 'https://github.com/a/b#secret', 'https://github.com:444/a/b', 'https://evil.example/a/b', 'https://github.com/a/.git']) assert.throws(() => parse(url));
assert.equal(parse(message.repository), 'https://github.com/Example/repository');
await handle(message, popup);
assert.equal(opened.length, 1);
const tabURL = new URL(opened[0].url);
assert.equal(tabURL.origin, 'https://redaxa.getcertsprint.com');
assert.equal(tabURL.pathname, '/github.html');
assert.equal(tabURL.searchParams.get('repo'), 'https://github.com/Example/repository');
assert.equal(tabURL.searchParams.get('source'), 'extension');
assert.equal(opened[0].url.includes(session.access_token), false);
// The web repository check is free; the page applies the daily allowance.
account = { active: false, repositoryAccess: false, plan: 'personal', status: 'canceled' };
const beforeOpen = calls;
await handle(message, popup);
assert.equal(opened.length, 2, 'free accounts and visitors can open the web repository check');
assert.equal(calls, beforeOpen, 'opening needs no account request');
const before = calls;
await assert.rejects(handle(message, { url: 'https://chatgpt.com' }), /popup/);
assert.equal(calls, before, 'content-script cannot initiate privileged navigation');
account = { active: true, repositoryAccess: true, plan: null, status: null };
const status = await handle({ type: 'STATUS' }, { url: 'https://chatgpt.com' });
assert.equal(status.repositoryAccess, true);
assert.equal(status.access_token, undefined);
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
session.expires_at = 0;
context.fetch = async () => ({ ok: false, status: 503 });
const unavailable = await handle({ type: 'STATUS' }, popup);
assert.equal(unavailable.signedIn, true, 'Transient auth failure keeps the account visible');
assert.equal(unavailable.active, false, 'Transient auth failure cannot unlock paid features');
console.log('Extension background: local checks send nothing, account checks stay authenticated, free repository link, safe navigation and popup boundary passed.');
