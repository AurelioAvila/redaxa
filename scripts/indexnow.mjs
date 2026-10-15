#!/usr/bin/env node
// Notifies IndexNow (Bing, Yandex, Seznam, Naver and others share submissions) of the
// URLs in the live sitemaps. Free and keyless apart from the key file the site already
// serves at its root. Run it after a production deploy, never before:
//   node scripts/indexnow.mjs [--dry-run] [--only <substring>]
import { readdirSync, readFileSync } from "node:fs";

const ORIGIN = "https://redaxa.getcertsprint.com";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";

const keyFile = readdirSync(new URL("../", import.meta.url)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error("No IndexNow key file at the repository root");
const key = readFileSync(new URL(`../${keyFile}`, import.meta.url), "utf8").trim();
if (key !== keyFile.slice(0, -4)) throw new Error("Key file content must equal its name");

const text = async (url) => {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
};
if ((await text(`${ORIGIN}/${keyFile}`)).trim() !== key) throw new Error("The live key file does not match: deploy first");

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
const root = await text(`${ORIGIN}/sitemap.xml`);
const urls = root.includes("<sitemapindex") ? (await Promise.all(locs(root).map(async (s) => locs(await text(s))))).flat() : locs(root);
const list = [...new Set(urls)].filter((u) => u.startsWith(`${ORIGIN}/`) && u.includes(only));
console.log(`${list.length} URLs${dryRun ? " (dry run)" : ""}`);
if (dryRun) { console.log(list.join("\n")); process.exit(0); }

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(ORIGIN).host, key, keyLocation: `${ORIGIN}/${keyFile}`, urlList: list }),
});
console.log(`IndexNow answered ${res.status} ${res.statusText}`);
if (res.status !== 200 && res.status !== 202) process.exit(1);
