import assert from 'node:assert/strict';
import { parseLockfile, auditDependencies, LOCKFILE } from './repository-deps.js';

const npm = parseLockfile('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {
  '': { name: 'app', version: '1.0.0' },
  'node_modules/minimist': { version: '1.2.0' },
  'node_modules/@scope/pkg': { version: '2.0.0', dev: true },
  'node_modules/local': { link: true }
} }));
assert.deepEqual(npm.map(d => `${d.name}@${d.version}${d.dev ? ' dev' : ''}`), ['minimist@1.2.0', '@scope/pkg@2.0.0 dev']);

const yarn = parseLockfile('yarn.lock', '"lodash@^4.17.0", lodash@^4.17.15:\n  version "4.17.15"\n\n"@babel/core@^7.0.0":\n  version "7.1.0"\n');
assert.deepEqual(yarn.map(d => `${d.name}@${d.version}`), ['lodash@4.17.15', '@babel/core@7.1.0']);

const pnpm = parseLockfile('pnpm-lock.yaml', "packages:\n\n  /axios@0.21.0:\n    resolution: {}\n  '@types/node@20.1.0':\n    resolution: {}\n");
assert.deepEqual(pnpm.map(d => `${d.name}@${d.version}`), ['axios@0.21.0', '@types/node@20.1.0']);

const cargo = parseLockfile('Cargo.lock', '[[package]]\nname = "glib"\nversion = "0.18.5"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n\n[[package]]\nname = "mycrate"\nversion = "0.1.0"\n');
assert.deepEqual(cargo.map(d => `${d.ecosystem}:${d.name}@${d.version}`), ['crates.io:glib@0.18.5'], 'local crates without a registry source are skipped');

assert.deepEqual(parseLockfile('requirements.txt', 'Django==3.2.0\nrequests>=2\nflask[async]==2.0.1 ; python_version>"3"\n').map(d => `${d.name}@${d.version}`), ['Django@3.2.0', 'flask@2.0.1']);
assert.deepEqual(parseLockfile('go.mod', 'module x\n\nrequire (\n\tgolang.org/x/net v0.7.0\n\tgithub.com/a/b v1.2.3 // indirect\n)\n').map(d => `${d.name}@${d.version}`), ['golang.org/x/net@0.7.0', 'github.com/a/b@1.2.3']);
assert.deepEqual(parseLockfile('Gemfile.lock', 'GEM\n  specs:\n    rails (6.0.0)\n      actionpack (= 6.0.0)\n').map(d => `${d.name}@${d.version}`), ['rails@6.0.0']);
assert.deepEqual(parseLockfile('package-lock.json', '{not json'), [], 'malformed lockfiles yield nothing');
assert.ok(LOCKFILE.test('web/package-lock.json') && LOCKFILE.test('requirements-dev.txt') && !LOCKFILE.test('package.json'));

// OSV: aliases collapse, informational notices rank last, network failure never throws.
const osv = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  if (u.endsWith('/querybatch')) {
    const body = JSON.parse(String(init?.body));
    assert.ok(body.queries.every((q: any) => !('commit' in q)), 'only names and versions are sent');
    return Response.json({ results: body.queries.map((q: any) => ({ vulns: q.package.name === 'minimist' ? [{ id: 'GHSA-xvch-5gv4-984h' }, { id: 'CVE-2021-44906' }] : q.package.name === 'glib' ? [{ id: 'RUSTSEC-2024-0370' }] : [] })) });
  }
  if (u.endsWith('GHSA-xvch-5gv4-984h')) return Response.json({ id: 'GHSA-xvch-5gv4-984h', aliases: ['CVE-2021-44906'], summary: 'Prototype Pollution in minimist', database_specific: { severity: 'CRITICAL' }, affected: [{ package: { ecosystem: 'npm', name: 'minimist' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '1.2.6' }] }] }] });
  if (u.endsWith('CVE-2021-44906')) return Response.json({ id: 'CVE-2021-44906', aliases: ['GHSA-xvch-5gv4-984h'] });
  if (u.endsWith('RUSTSEC-2024-0370')) return Response.json({ id: 'RUSTSEC-2024-0370', summary: 'unmaintained', affected: [{ package: { ecosystem: 'crates.io', name: 'glib' }, database_specific: { informational: 'unmaintained' } }] });
  return new Response('missing', { status: 404 });
}) as typeof fetch;
const audit = await auditDependencies([...npm, ...cargo], osv);
assert.equal(audit.checked, 3);
assert.equal(audit.advisories.length, 2, 'GHSA and its CVE alias are one advisory');
assert.deepEqual(audit.advisories.map(a => [a.name, a.severity, a.fixed ?? null, a.informational ?? null]), [['minimist', 'critical', '1.2.6', null], ['glib', 'low', null, 'unmaintained']]);
assert.ok(audit.complete);

const down = await auditDependencies(npm, (async () => { throw new Error('offline'); }) as typeof fetch);
assert.equal(down.complete, false); assert.equal(down.advisories.length, 0); assert.ok(down.note);
console.log('Dependency audit: npm/yarn/pnpm/Cargo/PyPI/Go/RubyGems parsing, alias collapse, informational ranking and offline tolerance passed.');
