import assert from "node:assert/strict";
import { pack } from "tar-stream";
import { gzipSync } from "node:zlib";
import { handleRepositoryCheck } from "./_repository.js";

const secret = "sk_live_" + "51HtestOnlyNotARealKey0123456789abcd";
const sha = "d".repeat(40);
const tar = pack(); const chunks: Buffer[] = []; const collect = (async () => { for await (const c of tar) chunks.push(c); })();
tar.entry({ name: `repo-${sha}/server.env` }, "STRIPE_SECRET_KEY=" + secret);
tar.entry({ name: `repo-${sha}/package-lock.json` }, JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/minimist": { version: "1.2.0" } } }));
tar.finalize(); await collect; const archive = gzipSync(Buffer.concat(chunks));

const calls: string[] = [];
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url); calls.push(u);
  if (u === "https://codeload.github.com/o/repo/tar.gz/HEAD") return new Response(archive);
  if (u === "https://codeload.github.com/o/private/tar.gz/HEAD") return new Response("", { status: 404 });
  if (u.endsWith("/querybatch")) return Response.json({ results: [{ vulns: [{ id: "GHSA-xvch-5gv4-984h" }] }] });
  if (u.includes("/vulns/")) return Response.json({ id: "GHSA-xvch-5gv4-984h", summary: "Prototype Pollution in minimist", database_specific: { severity: "CRITICAL" }, affected: [{ package: { ecosystem: "npm", name: "minimist" }, ranges: [{ events: [{ fixed: "1.2.6" }] }] }] });
  return new Response("unexpected", { status: 500 });
}) as typeof fetch;
const service = (async () => new Response("false")) as unknown as (p: string) => Promise<Response>;
const call = async (input: unknown, who = { userId: null as string | null, paid: false, ip: "198.51.100.7" }) => {
  let status = 0, body: any;
  const res = { status(code: number) { status = code; return res; }, json(v: unknown) { body = v; } };
  await handleRepositoryCheck(input, who, service, res);
  return { status, body };
};

const ok = await call("https://github.com/o/repo");
assert.equal(ok.status, 200);
assert.equal(ok.body.commit, sha);
assert.ok(!JSON.stringify(ok.body).includes(secret), "values are never returned by the web check");
assert.ok(ok.body.findings.some((f: any) => f.credential?.service === "Stripe" && f.url.includes(`/blob/${sha}/server.env`)));
assert.ok(ok.body.findings.every((f: any) => !("value" in f)));
assert.ok(ok.body.coverage.every((c: any) => c.status !== "scanned"));
assert.equal(ok.body.dependencies.advisories[0].fixed, "1.2.6");
assert.ok(!calls.some(u => u.startsWith("https://api.github.com/")), "no GitHub API quota is used");

const priv = await call("https://github.com/o/private"); assert.equal(priv.status, 400, JSON.stringify(priv.body));
assert.equal((await call("not a url")).status, 400);
assert.equal((await call(42)).status, 400);
// Three per day for a visitor, counted even when a check fails.
const visitor = { userId: null, paid: false, ip: "203.0.113.9" };
for (let i = 0; i < 3; i++) assert.notEqual((await call("https://github.com/o/repo", visitor)).status, 402);
const limited = await call("https://github.com/o/repo", visitor);
assert.equal(limited.status, 402); assert.equal(limited.body.error, "REPOSITORY_LIMIT");
assert.equal((await call("https://github.com/o/repo", { userId: "u1", paid: true, ip: "203.0.113.9" })).status, 200, "a paid account has its own allowance");
console.log("Web repository check: masked results, no GitHub API, dependency advisories, input errors and daily allowance passed.");
const busy = (async (_p: string, init?: RequestInit) => new Response(String(JSON.parse(String(init?.body)).p_key === "repo:global"))) as unknown as (p: string) => Promise<Response>;
let busyStatus = 0; const busyRes = { status(c: number) { busyStatus = c; return busyRes; }, json() {} };
await handleRepositoryCheck("https://github.com/o/repo", { userId: "u9", paid: true, ip: "198.51.100.99" }, busy, busyRes);
assert.equal(busyStatus, 503, "the whole-service daily ceiling stops further checks");
console.log("Global daily ceiling passed.");
