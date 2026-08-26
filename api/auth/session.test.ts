import assert from "node:assert/strict";

// Dummy values so module-level `required(...)` calls in the shared
// `_billing.ts` (imported transitively by session.ts) succeed at import
// time. No network call is made with them here.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

const { default: handler } = await import("./session.js");

// Covers only the /api/auth-config path folded into this file (see the
// rewrite in vercel.json): a Hobby-plan deployment caps out at 12 Serverless
// Functions, and this 30-line GET-only probe didn't earn its own slot next
// to the session endpoint it now shares a file with. The session-check paths
// themselves need Supabase network access and are exercised elsewhere.
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
  handler({ method, url: "/api/auth-config", headers: origin ? { origin } : {} }, response);
  return { headers, statusCode, body };
}

const appOrigin = "https://promptshield-beta.vercel.app";

// `configured` just reflects whether SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY
// are set - both dummied in above so the module can import at all - so this
// checks the CORS behavior on a disallowed origin, not the boolean's value.
const hostile = invoke("GET", "https://attacker.example");
assert.equal(hostile.headers.get("Access-Control-Allow-Origin"), appOrigin);
assert.equal(hostile.headers.get("Vary"), "Origin");
assert.deepEqual(hostile.body, { configured: true });

const desktop = invoke("GET", "https://tauri.localhost");
assert.equal(desktop.headers.get("Access-Control-Allow-Origin"), "https://tauri.localhost");

const extension = invoke("GET", "chrome-extension://test-extension-id");
assert.equal(extension.headers.get("Access-Control-Allow-Origin"), "chrome-extension://test-extension-id");

const preflight = invoke("OPTIONS", appOrigin);
assert.equal(preflight.statusCode, 204);

console.log("Redaxa auth configuration tests passed.");
