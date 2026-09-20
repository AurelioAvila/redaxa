import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

// The scanner lives behind private native IPC and is never copied into the
// webview assets. Package its own runtime so customers need no Node/Git install.
await import('./build-repository-runtime.mjs');

const root = process.cwd();
const output = resolve(root, "desktop-dist");
if(dirname(output)!==resolve(root)||basename(output)!=='desktop-dist')throw new Error('Unsafe build output path');

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ["dashboard.html", "github.html", "repository.css", "brand-system.css", "auth.css", "manifest.webmanifest", "service-worker.js"]) {
  cpSync(resolve(root, file), resolve(output, file));
}
// The desktop product opens the focused workspace, not the public marketing landing page.
cpSync(resolve(root, "dashboard.html"), resolve(output, "index.html"));
// See build-web.mjs: scanner.js is intentionally excluded so the desktop
// webview's DevTools console can't call inspectPrompt() directly and bypass
// the server-enforced trial/subscription check in api/scan.ts.
mkdirSync(resolve(output, 'dist'), {recursive:true});
for(const module of ['auth','dashboard','desktop','pwa','repository-ui','repository-report','repository-example']) {
  cpSync(resolve(root,'dist',module+'.js'),resolve(output,'dist',module+'.js'));
}
cpSync(resolve(root, "outputs"), resolve(output, "outputs"), { recursive: true });
