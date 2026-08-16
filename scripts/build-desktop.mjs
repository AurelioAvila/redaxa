import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "desktop-dist");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ["dashboard.html", "auth.css", "manifest.webmanifest", "service-worker.js"]) {
  cpSync(resolve(root, file), resolve(output, file));
}
// The desktop product opens the focused workspace, not the public marketing landing page.
cpSync(resolve(root, "dashboard.html"), resolve(output, "index.html"));
// See build-web.mjs: scanner.js is intentionally excluded so the desktop
// webview's DevTools console can't call inspectPrompt() directly and bypass
// the server-enforced trial/subscription check in api/scan.ts.
cpSync(resolve(root, "dist"), resolve(output, "dist"), {
  recursive: true,
  filter: (src) => !/[\\/]scanner(\.test)?\.js(\.map)?$/.test(src)
});
cpSync(resolve(root, "outputs"), resolve(output, "outputs"), { recursive: true });
