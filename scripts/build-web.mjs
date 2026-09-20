import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

const root = process.cwd();
const output = resolve(root, "public");
if(dirname(output)!==resolve(root)||basename(output)!=='public')throw new Error('Unsafe build output path');

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ["index.html", "dashboard.html", "github.html", "repository.css", "brand-system.css", "privacy.html", "terms.html", "api-docs.html", "redact-sensitive-data-before-chatgpt.html", "auth.css", "manifest.webmanifest", "service-worker.js", "robots.txt", "sitemap.xml"]) {
  cpSync(resolve(root, file), resolve(output, file));
}

// scanner.js/scanner.test.js are deliberately left out of the public bundle:
// only dashboard.ts/auth.ts import *types* from scanner.ts (erased at compile
// time), never the runtime module, so nothing legitimate needs it shipped as
// a static file -- and shipping it anyway would let anyone call inspectPrompt()
// straight from the browser console, fully bypassing the trial/subscription
// gate that api/scan.ts enforces server-side.
mkdirSync(resolve(output, 'dist'), {recursive:true});
for(const module of ['auth','dashboard','desktop','pwa','landing','growth','repository-ui','repository-report','repository-example']) {
  cpSync(resolve(root,'dist',module+'.js'),resolve(output,'dist',module+'.js'));
}
mkdirSync(resolve(output, "outputs"), { recursive: true });
cpSync(resolve(root, "outputs", "redaxa-mark.svg"), resolve(output, "outputs", "redaxa-mark.svg"));
// og-image.png is the 1200x630 social card, not the 1024x1024 app mark: link
// previews on X/LinkedIn/Slack need the wide ratio, and a square source gets
// centre-cropped into an unreadable tile.
cpSync(resolve(root, "brand", "og-image.png"), resolve(output, "og-image.png"));
