import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "desktop-dist");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ["index.html", "dashboard.html", "manifest.webmanifest", "service-worker.js"]) {
  cpSync(resolve(root, file), resolve(output, file));
}
cpSync(resolve(root, "dist"), resolve(output, "dist"), { recursive: true });
cpSync(resolve(root, "outputs"), resolve(output, "outputs"), { recursive: true });
