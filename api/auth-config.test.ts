import assert from "node:assert/strict";
import handler from "./auth-config.js";

function invoke(method: string, origin?: string) {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown;
  const response = {
    setHeader(name: string, value: string) { headers.set(name, value); },
    status(code: number) { statusCode = code; return response; },
    json(value: unknown) { body = value; },
    end() { return undefined; }
  };
  handler({ method, headers: origin ? { origin } : {} }, response);
  return { headers, statusCode, body };
}

const appOrigin = "https://promptshield-beta.vercel.app";

const hostile = invoke("GET", "https://attacker.example");
assert.equal(hostile.headers.get("Access-Control-Allow-Origin"), appOrigin);
assert.equal(hostile.headers.get("Vary"), "Origin");
assert.deepEqual(hostile.body, { configured: false });

const desktop = invoke("GET", "https://tauri.localhost");
assert.equal(desktop.headers.get("Access-Control-Allow-Origin"), "https://tauri.localhost");

const extension = invoke("GET", "chrome-extension://test-extension-id");
assert.equal(extension.headers.get("Access-Control-Allow-Origin"), "chrome-extension://test-extension-id");

const preflight = invoke("OPTIONS", appOrigin);
assert.equal(preflight.statusCode, 204);
assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");

console.log("Redaxa auth configuration tests passed.");
