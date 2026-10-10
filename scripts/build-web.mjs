import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

const root = process.cwd();
const output = resolve(root, "public");
if(dirname(output)!==resolve(root)||basename(output)!=='public')throw new Error('Unsafe build output path');

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ["index.html", "dashboard.html", "github.html", "repository.css", "brand-system.css", "themes.css", "theme-boot.js", "cf-beacon.js", "privacy.html", "terms.html", "api-docs.html", "redact-sensitive-data-before-chatgpt.html", "check-public-github-repo-for-leaked-api-keys.html", "protect-client-and-project-names-in-ai-prompts.html", "what-not-to-paste-into-chatgpt-checklist.html", "auth.css", "manifest.webmanifest", "service-worker.js", "robots.txt", "sitemap.xml", "50dbe3a3e39c297a807eb935fcdaba29.txt"]) {
  cpSync(resolve(root, file), resolve(output, file));
}

// scanner.js/scanner.test.js are deliberately left out of the public bundle:
// only dashboard.ts/auth.ts import *types* from scanner.ts (erased at compile
// time), never the runtime module, so nothing legitimate needs it shipped as
// a static file -- and shipping it anyway would let anyone call inspectPrompt()
// straight from the browser console, fully bypassing the trial/subscription
// gate that api/scan.ts enforces server-side.
mkdirSync(resolve(output, 'dist'), {recursive:true});
for(const module of ['themes','auth','dashboard','desktop','pwa','landing','growth','promo','repository-ui','repository-report','repository-example']) {
  cpSync(resolve(root,'dist',module+'.js'),resolve(output,'dist',module+'.js'));
}
mkdirSync(resolve(output, "outputs"), { recursive: true });
cpSync(resolve(root, "outputs", "redaxa-mark.svg"), resolve(output, "outputs", "redaxa-mark.svg"));
// og-image.png is the 1200x630 social card, not the 1024x1024 app mark: link
// previews on X/LinkedIn/Slack need the wide ratio, and a square source gets
// centre-cropped into an unreadable tile.
cpSync(resolve(root, "brand", "og-image.png"), resolve(output, "og-image.png"));

for(const file of ["redaxa-inter.woff2", "Inter-LICENSE.txt"]) cpSync(resolve(root,"outputs",file),resolve(output,"outputs",file));
