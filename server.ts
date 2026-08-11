import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8"
};

createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

  if (pathname === "/health") {
    response.writeHead(200, securityHeaders("application/json; charset=utf-8"));
    response.end(JSON.stringify({ status: "ok", service: "promptshield", promptStorage: "none" }));
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);
  const insideRoot = filePath.startsWith(root + pathSeparator());

  if (!insideRoot || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, securityHeaders("text/plain; charset=utf-8"));
    response.end("Not found");
    return;
  }

  response.writeHead(200, securityHeaders(mimeTypes[extname(filePath)] ?? "application/octet-stream"));
  response.end(readFileSync(filePath));
}).listen(Number(process.env.PORT ?? 4173), "127.0.0.1");

function pathSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function securityHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}
