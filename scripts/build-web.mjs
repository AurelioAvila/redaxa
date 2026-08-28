import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "public");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ["index.html", "dashboard.html", "privacy.html", "terms.html", "api-docs.html", "auth.css", "manifest.webmanifest", "service-worker.js", "robots.txt", "sitemap.xml"]) {
  cpSync(resolve(root, file), resolve(output, file));
}

// scanner.js/scanner.test.js are deliberately left out of the public bundle:
// only dashboard.ts/auth.ts import *types* from scanner.ts (erased at compile
// time), never the runtime module, so nothing legitimate needs it shipped as
// a static file -- and shipping it anyway would let anyone call inspectPrompt()
// straight from the browser console, fully bypassing the trial/subscription
// gate that api/scan.ts enforces server-side.
cpSync(resolve(root, "dist"), resolve(output, "dist"), {
  recursive: true,
  filter: (src) => !/[\\/]scanner(\.test)?\.js(\.map)?$/.test(src)
});
mkdirSync(resolve(output, "outputs"), { recursive: true });
cpSync(resolve(root, "outputs", "redaxa-mark.svg"), resolve(output, "outputs", "redaxa-mark.svg"));
cpSync(resolve(root, "brand", "redaxa-master.png"), resolve(output, "og-image.png"));
