// Sitemaps by silo plus the index at /sitemap.xml (the URL Search Console and robots.txt already know).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORIGIN = "https://redaxa.getcertsprint.com";

export function urlset(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((e) => `  <url><loc>${e.loc}</loc><lastmod>${e.lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`;
}

/** Entries of one sitemap file: [{ loc, lastmod }]. */
export function readUrlset(xml) {
  return [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map((m) => ({ loc: m[1], lastmod: m[2] }));
}

/** The index lists each silo with the newest lastmod inside it. */
export function sitemapIndex(dir, files) {
  const items = files.map((file) => {
    const entries = readUrlset(readFileSync(resolve(dir, file), "utf8"));
    if (!entries.length) throw new Error(`${file} is empty`);
    return `  <sitemap><loc>${ORIGIN}/${file}</loc><lastmod>${entries.map((e) => e.lastmod).sort().at(-1)}</lastmod></sitemap>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</sitemapindex>\n`;
}
