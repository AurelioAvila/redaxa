import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('./', import.meta.url);
let account = { active: true, plan: 'personal', status: 'active' };
let session = { email: 'fixture@example.test', access_token: 'nonworking-test-token', refresh_token: 'fixture', expires_at: Date.now() + 3600000 };
const opened = [];
let calls = 0;
const context = vm.createContext({ URL, AbortController, AbortSignal, setTimeout, clearTimeout, console,
  fetch: async () => { calls++; return { ok: true, json: async () => account }; },
  chrome: { storage: { local: { get: async () => ({ redaxa_session: session }), set: async value => { session = value.redaxa_session; }, remove: async () => { session = null; } } },
    tabs: { create: async value => { opened.push(value); } },
    runtime: { id: 'fixture-id', getURL: path => `chrome-extension://fixture-id/${path}`, onMessage: { addListener() {} } }
  }
});
context.importScripts = filename => vm.runInContext(fs.readFileSync(new URL(filename, root), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('background.js', root), 'utf8'), context);
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
assert.equal(tabURL.origin, 'https://promptshield-beta.vercel.app');
assert.equal(tabURL.pathname, '/github.html');
assert.equal(tabURL.searchParams.get('repo'), 'https://github.com/Example/repository');
assert.equal(tabURL.searchParams.get('source'), 'extension');
assert.equal(opened[0].url.includes(session.access_token), false);
account = { active: false, repositoryAccess: false, plan: 'personal', status: 'canceled' };
await assert.rejects(handle(message, popup), /require an active/);
assert.equal(opened.length, 1, 'fresh entitlement revocation blocks opening');
const before = calls;
await assert.rejects(handle(message, { url: 'https://chatgpt.com' }), /popup/);
assert.equal(calls, before, 'content-script cannot initiate privileged navigation');
account = { active: true, repositoryAccess: true, plan: null, status: null };
const status = await handle({ type: 'STATUS' }, { url: 'https://chatgpt.com' });
assert.equal(status.repositoryAccess, true);
assert.equal(status.access_token, undefined);
console.log('Extension repository: verified entitlement, revocation, safe navigation and popup boundary passed.');
