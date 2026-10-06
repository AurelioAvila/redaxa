// Known vulnerabilities in a repository's pinned dependencies, from the public
// OSV.dev database (https://osv.dev). Only package names and versions read from
// lockfiles are sent; no source code, paths or findings leave the scan.

export type Ecosystem = 'npm' | 'crates.io' | 'PyPI' | 'Go' | 'Packagist' | 'RubyGems';
export type Dependency = { ecosystem: Ecosystem; name: string; version: string; file: string; dev?: boolean };
export type DependencyAdvisory = {
  id: string; aliases: string[]; summary: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  ecosystem: Ecosystem; name: string; version: string; fixed?: string; file: string; dev?: boolean; url: string;
  /** RustSec-style notice (unmaintained, yanked…) rather than an exploitable flaw. */
  informational?: string;
};
export type DependencyReport = {
  checked: number; files: string[]; vulnerable: number; advisories: DependencyAdvisory[];
  complete: boolean; note?: string;
};

const MAX_DEPENDENCIES = 5000;
const MAX_DETAILS = 200;
const OSV = 'https://api.osv.dev/v1';

export const LOCKFILE = /(?:^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|requirements[^/]*\.txt|go\.mod|composer\.lock|Gemfile\.lock)$/;

const clean = (v: string) => v.trim().replace(/^v(?=\d)/, '');
const plausible = (name: string, version: string) =>
  !!name && name.length <= 214 && !!version && version.length <= 64 && /^\d/.test(clean(version)) && !/[\s"'<>]/.test(name + version);

/** Parses one lockfile; unsupported or malformed content yields nothing. */
export function parseLockfile(path: string, text: string): Dependency[] {
  const base = path.split('/').pop() ?? '';
  const out: Dependency[] = [];
  const add = (ecosystem: Ecosystem, name: string, version: string, dev?: boolean) => {
    if (plausible(name, version)) out.push({ ecosystem, name, version: clean(version), file: path, ...(dev ? { dev } : {}) });
  };
  try {
    if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') {
      const lock = JSON.parse(text);
      if (lock.packages && typeof lock.packages === 'object') {
        for (const [key, value] of Object.entries<any>(lock.packages)) {
          if (!key) continue; // the root project itself
          const name = value?.name ?? key.split('node_modules/').pop();
          if (!value?.link) add('npm', name, String(value?.version ?? ''), value?.dev === true);
        }
      } else if (lock.dependencies) {
        const walk = (deps: Record<string, any>) => {
          for (const [name, value] of Object.entries(deps)) { add('npm', name, String(value?.version ?? ''), value?.dev === true); if (value?.dependencies) walk(value.dependencies); }
        };
        walk(lock.dependencies);
      }
    } else if (base === 'yarn.lock') {
      // "pkg@^1", "@scope/pkg@npm:^2":  followed by an indented   version "1.2.3"
      let names: string[] = [];
      for (const line of text.split(/\r?\n/)) {
        if (/^\S.*:$/.test(line) && !line.startsWith('#')) {
          names = line.slice(0, -1).split(',').map(s => s.trim().replace(/^"|"$/g, '')).map(s => s.slice(0, s.lastIndexOf('@') > 0 ? s.lastIndexOf('@') : s.length));
        } else {
          const m = line.match(/^\s+version:?\s+"?([^"\s]+)"?\s*$/);
          if (m && names.length) { for (const n of new Set(names)) add('npm', n, m[1]); names = []; }
        }
      }
    } else if (base === 'pnpm-lock.yaml') {
      // v6: "  /name@1.2.3:"  or "  /@scope/name@1.2.3(peer@x):"; v9: "  name@1.2.3:"
      for (const m of text.matchAll(/^ {2}'?\/?((?:@[^@/\s]+\/)?[^@/\s(]+)@(\d[^(:'\s]*)/gm)) add('npm', m[1], m[2]);
    } else if (base === 'Cargo.lock' || base === 'poetry.lock') {
      const ecosystem: Ecosystem = base === 'Cargo.lock' ? 'crates.io' : 'PyPI';
      for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
        const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
        const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
        // Cargo: path/git crates have no registry source and are not in OSV.
        if (ecosystem === 'crates.io' && !/^source\s*=\s*"registry\+/m.test(block)) continue;
        if (name && version) add(ecosystem, name, version, ecosystem === 'PyPI' && /^category\s*=\s*"dev"/m.test(block));
      }
    } else if (/^requirements[^/]*\.txt$/.test(base)) {
      for (const m of text.matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([0-9][^\s;#]*)/gm)) add('PyPI', m[1], m[2]);
    } else if (base === 'go.mod') {
      for (const m of text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+(v\d[^\s]*)/gm)) add('Go', m[1], m[2]);
    } else if (base === 'composer.lock') {
      const lock = JSON.parse(text);
      for (const p of lock.packages ?? []) add('Packagist', p.name, String(p.version ?? ''));
      for (const p of lock['packages-dev'] ?? []) add('Packagist', p.name, String(p.version ?? ''), true);
    } else if (base === 'Gemfile.lock') {
      for (const m of text.matchAll(/^ {4}([A-Za-z0-9._-]+) \(([0-9][^)\s]*)\)\s*$/gm)) add('RubyGems', m[1], m[2]);
    }
  } catch { /* malformed lockfile: nothing to report from it */ }
  return out;
}

const informationalOf = (vuln: any): string | undefined =>
  [vuln?.database_specific, ...(vuln?.affected ?? []).map((a: any) => a?.database_specific)].map(d => d?.informational).find(i => typeof i === 'string');

function severityOf(vuln: any): DependencyAdvisory['severity'] {
  if (informationalOf(vuln)) return 'low';
  const s = String(vuln?.database_specific?.severity ?? '').toUpperCase();
  if (s === 'CRITICAL') return 'critical';
  if (s === 'HIGH') return 'high';
  if (s === 'MODERATE' || s === 'MEDIUM') return 'medium';
  if (s === 'LOW') return 'low';
  return 'unknown';
}

function fixedVersion(vuln: any, dep: Dependency): string | undefined {
  for (const a of vuln?.affected ?? []) {
    if (a?.package?.ecosystem !== dep.ecosystem || String(a?.package?.name).toLowerCase() !== dep.name.toLowerCase()) continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (typeof e.fixed === 'string') return e.fixed;
  }
  return undefined;
}

const rank = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };

/** Looks up every dependency in OSV. Network failure returns an incomplete report, never a throw. */
export async function auditDependencies(dependencies: Dependency[], fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<DependencyReport> {
  const unique = new Map<string, Dependency>();
  for (const d of dependencies) {
    const key = `${d.ecosystem}\0${d.name.toLowerCase()}\0${d.version}`;
    const prev = unique.get(key);
    // Prefer the runtime entry when the same version is both dev and runtime.
    if (!prev || (prev.dev && !d.dev)) unique.set(key, d);
  }
  const deps = [...unique.values()].slice(0, MAX_DEPENDENCIES);
  const files = [...new Set(dependencies.map(d => d.file))].sort();
  const report: DependencyReport = { checked: deps.length, files, vulnerable: 0, advisories: [], complete: unique.size <= MAX_DEPENDENCIES };
  if (!deps.length) return report;
  try {
    const hits: { dep: Dependency; ids: string[] }[] = [];
    for (let i = 0; i < deps.length; i += 1000) {
      const chunk = deps.slice(i, i + 1000);
      const response = await fetcher(`${OSV}/querybatch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal,
        body: JSON.stringify({ queries: chunk.map(d => ({ package: { name: d.name, ecosystem: d.ecosystem }, version: d.version })) })
      });
      if (!response.ok) throw new Error(`OSV ${response.status}`);
      const body = await response.json() as { results?: { vulns?: { id: string }[]; next_page_token?: string }[] };
      (body.results ?? []).forEach((r, index) => {
        if (r.next_page_token) report.complete = false;
        const ids = (r.vulns ?? []).map(v => v.id).filter(id => typeof id === 'string' && /^[A-Za-z0-9._:-]{3,80}$/.test(id));
        if (ids.length && chunk[index]) hits.push({ dep: chunk[index], ids });
      });
    }
    report.vulnerable = hits.length;
    const ids = [...new Set(hits.flatMap(h => h.ids))];
    if (ids.length > MAX_DETAILS) report.complete = false;
    const details = new Map<string, any>();
    const queue = ids.slice(0, MAX_DETAILS);
    await Promise.all(Array.from({ length: Math.min(16, queue.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          const r = await fetcher(`${OSV}/vulns/${encodeURIComponent(id)}`, { redirect: 'error', signal });
          if (r.ok) details.set(id, await r.json());
        } catch { report.complete = false; }
      }
    }));
    for (const { dep, ids: depIds } of hits) {
      // One row per advisory and package; aliases (CVE ↔ GHSA) collapse into one.
      const seen = new Set<string>();
      for (const id of depIds) {
        const v = details.get(id);
        const aliases: string[] = Array.isArray(v?.aliases) ? v.aliases.filter((a: unknown) => typeof a === 'string').slice(0, 6) : [];
        if (seen.has(id) || aliases.some(a => seen.has(a))) continue;
        seen.add(id); aliases.forEach(a => seen.add(a));
        report.advisories.push({
          id, aliases, summary: String(v?.summary ?? v?.details ?? 'Known vulnerability; open the advisory for details.').slice(0, 300),
          severity: v ? severityOf(v) : 'unknown', ecosystem: dep.ecosystem, name: dep.name, version: dep.version,
          fixed: v ? fixedVersion(v, dep) : undefined, file: dep.file, ...(dep.dev ? { dev: true } : {}),
          ...(informationalOf(v) ? { informational: informationalOf(v) } : {}),
          url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`
        });
      }
    }
    report.advisories.sort((a, b) => (Number(!!a.informational) - Number(!!b.informational)) || (Number(!!a.dev) - Number(!!b.dev)) || rank[a.severity] - rank[b.severity] || a.name.localeCompare(b.name));
  } catch {
    report.complete = false;
    report.note = 'The vulnerability database could not be reached; dependency results are incomplete.';
  }
  return report;
}
