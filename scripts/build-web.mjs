import { cpSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

const root = process.cwd();
const output = resolve(root, "public");
if(dirname(output)!==resolve(root)||basename(output)!=='public')throw new Error('Unsafe build output path');

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ["index.html", "dashboard.html", "github.html", "repository.css", "brand-system.css", "themes.css", "app.css", "plans.css", "dialogs.css", "theme-boot.js", "cf-beacon.js", "privacy.html", "terms.html", "api-docs.html", "redact-sensitive-data-before-chatgpt.html", "check-public-github-repo-for-leaked-api-keys.html", "protect-client-and-project-names-in-ai-prompts.html", "what-not-to-paste-into-chatgpt-checklist.html", "auth.css", "manifest.webmanifest", "service-worker.js", "robots.txt", "sitemap.xml", "50dbe3a3e39c297a807eb935fcdaba29.txt"]) {
  cpSync(resolve(root, file), resolve(output, file));
}

// scanner.js/scanner.test.js are deliberately left out of the public bundle:
// only dashboard.ts/auth.ts import *types* from scanner.ts (erased at compile
// time), never the runtime module, so nothing legitimate needs it shipped as
// a static file -- and shipping it anyway would let anyone call inspectPrompt()
// straight from the browser console, fully bypassing the trial/subscription
// gate that api/scan.ts enforces server-side.
mkdirSync(resolve(output, 'dist'), {recursive:true});
for(const module of ['themes','auth','dashboard','desktop','pwa','landing','growth','promo','trial','halloween-decor','repository-ui','repository-report','repository-example']) {
  cpSync(resolve(root,'dist',module+'.js'),resolve(output,'dist',module+'.js'));
}
// RFC 9116: where to report a vulnerability, at the standard path.
mkdirSync(resolve(output, ".well-known"), { recursive: true });
cpSync(resolve(root, ".well-known", "security.txt"), resolve(output, ".well-known", "security.txt"));
mkdirSync(resolve(output, "outputs"), { recursive: true });
cpSync(resolve(root, "outputs", "redaxa-mark.svg"), resolve(output, "outputs", "redaxa-mark.svg"));
// Email clients do not render SVG: the PNG is the logo in every Redaxa email.
cpSync(resolve(root, "outputs", "redaxa-mark-128.png"), resolve(output, "outputs", "redaxa-mark-128.png"));
// The 1200x630 link-preview card: a real capture of the prompt check, with no
// price or version inside. The hash in the name changes with the image, so
// Discord, X, Facebook and LinkedIn fetch the new card instead of a cached one.
cpSync(resolve(root, "brand", "og-redaxa-eb3e35858c.png"), resolve(output, "og-redaxa-eb3e35858c.png"));

for(const file of ["redaxa-inter.woff2", "Inter-LICENSE.txt"]) cpSync(resolve(root,"outputs",file),resolve(output,"outputs",file));
// Windows and Linux checkouts must produce identical bytes for publisher verification.
const textExtensions = /\.(?:html|css|js|txt|xml|svg|webmanifest|json)$/i;
function normalizeStaticText(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) normalizeStaticText(file);
    else if (textExtensions.test(entry.name)) writeFileSync(file, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  }
}
normalizeStaticText(output);
// Keep the publisher catalog available alongside the exact static build it signs.
cpSync(resolve(root, "web-release.cat"), resolve(output, "web-release.cat"));
