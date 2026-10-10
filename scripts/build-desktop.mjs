import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

// The scanner lives behind private native IPC and is never copied into the
// webview assets. Package its own runtime so customers need no Node/Git install.
await import('./build-repository-runtime.mjs');

const root = process.cwd();
const output = resolve(root, "desktop-dist");
if(dirname(output)!==resolve(root)||basename(output)!=='desktop-dist')throw new Error('Unsafe build output path');

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ["dashboard.html", "github.html", "repository.css", "brand-system.css", "themes.css", "app.css", "plans.css", "theme-boot.js", "auth.css", "manifest.webmanifest", "service-worker.js"]) {
  cpSync(resolve(root, file), resolve(output, file));
}
// The desktop product opens the focused workspace, not the public marketing landing page.
cpSync(resolve(root, "dashboard.html"), resolve(output, "index.html"));
// See build-web.mjs: scanner.js is intentionally excluded so the desktop
// webview's DevTools console can't call inspectPrompt() directly and bypass
// the server-enforced trial/subscription check in api/scan.ts.
mkdirSync(resolve(output, 'dist'), {recursive:true});
const modules = ['themes','auth','dashboard','desktop','pwa','growth','promo','halloween-decor','repository-ui','repository-report','repository-example'];
for(const module of modules) {
  cpSync(resolve(root,'dist',module+'.js'),resolve(output,'dist',module+'.js'));
}
// A module imported but missing from the list above is answered with
// index.html by the webview, which kills its whole import graph (growth.js
// once took the title bar, sign-in and checks down with it). Fail the build
// instead. tsc drops type-only imports, so scanner.js never shows up here.
for(const module of modules) {
  const code = readFileSync(resolve(output,'dist',module+'.js'),'utf8');
  for(const m of code.matchAll(/from\s*["'](\.\/[^"']+)["']|import\(\s*["'](\.\/[^"']+)["']/g)) {
    const spec = m[1] ?? m[2];
    if(!existsSync(resolve(output,'dist',spec))) throw new Error(`desktop-dist/dist/${module}.js imports ${spec}, which is not packaged`);
  }
}
cpSync(resolve(root, "outputs"), resolve(output, "outputs"), { recursive: true });
