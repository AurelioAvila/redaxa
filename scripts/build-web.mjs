import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "public");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ["index.html", "dashboard.html", "dashboard.css", "auth.css", "manifest.webmanifest", "service-worker.js"]) {
  cpSync(resolve(root, file), resolve(output, file));
}

cpSync(resolve(root, "dist"), resolve(output, "dist"), { recursive: true });
mkdirSync(resolve(output, "outputs"), { recursive: true });
cpSync(resolve(root, "outputs", "promptshield-mark.svg"), resolve(output, "outputs", "promptshield-mark.svg"));
