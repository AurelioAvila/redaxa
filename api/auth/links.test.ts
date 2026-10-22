// Email-link flows: confirmation and password reset by one-time hash, plus sign-in error copy.
import assert from "node:assert/strict";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
delete process.env.RESEND_API_KEY;
const { default: signup, confirmationHash } = await import("./signup.js");
const { default: recover } = await import("./recover.js");
const { signinError } = await import("./signin.js");

type Call = { url: string; method?: string; body?: Record<string, unknown>; auth?: string };
const calls: Call[] = [];
let verifyOk = true;
let weakPassword = false;
const hash = "a".repeat(56);
const originalFetch = globalThis.fetch;
let sharedLimited = false;
globalThis.fetch = (async (input: string, options: RequestInit = {}) => {
  // The shared rate-limit counter answers on its own, outside the recorded flow.
  if (String(input).endsWith("/rest/v1/rpc/rate_limit_hit")) return Response.json(sharedLimited);
  const headers = new Headers(options.headers);
  calls.push({ url: String(input), method: options.method, body: options.body ? JSON.parse(String(options.body)) : undefined, auth: headers.get("authorization") ?? undefined });
  const url = String(input);
  if (url.endsWith("/auth/v1/verify")) {
    if (!verifyOk) return Response.json({ msg: "expired" }, { status: 403 });
    return Response.json({ access_token: "verified-access", user: { id: "user-1", email: "person@example.com", email_confirmed_at: "2026-10-14T00:00:00Z", created_at: "2026-10-14T00:00:00Z", user_metadata: { first_name: "Ada", welcomed_at: "2026-10-14T00:00:00Z" } } });
  }
  if (url.endsWith("/auth/v1/user") && options.method === "PUT") return weakPassword ? Response.json({ error_code: "weak_password", msg: "Password is known to be weak." }, { status: 422 }) : Response.json({ id: "user-1" });
  if (url.endsWith("/auth/v1/user")) return Response.json({ id: "user-1", email: "person@example.com", user_metadata: { first_name: "Ada" } });
  if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
  if (url.includes("/auth/v1/recover") || url.includes("/auth/v1/signup") || url.includes("/auth/v1/resend")) return Response.json({});
  throw new Error(`Unexpected request ${url}`);
}) as typeof globalThis.fetch;

async function invoke(handler: typeof signup, body: unknown, query: Record<string, string> = {}) {
  let status = 0;
  let result: unknown;
  const response = { setHeader() {}, status(code: number) { status = code; return response; }, json(value: unknown) { result = value; }, end() {} };
  await handler({ method: "POST", body, headers: { origin: "https://redaxa.getcertsprint.com" }, query } as never, response);
  return { status, result: result as Record<string, unknown> };
}

try {
  // Confirmation: the hash is verified once, nobody is signed in, the verified session is ended.
  assert.equal(confirmationHash("short"), null);
  assert.equal(confirmationHash(hash), hash);
  assert.equal((await invoke(signup, { confirm: "not a hash" })).status, 400);
  assert.equal(calls.length, 0, "a malformed hash never reaches the provider");
  const confirmed = await invoke(signup, { confirm: hash });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.result.email, "person@example.com");
  assert.equal("access_token" in confirmed.result, false, "confirming must not hand out a session");
  assert.deepEqual(calls[0].body, { type: "email", token_hash: hash });
  assert.ok(calls.some(call => call.url.endsWith("/auth/v1/logout?scope=local") && call.auth === "Bearer verified-access"));
  verifyOk = false;
  assert.equal((await invoke(signup, { confirm: hash })).status, 400);
  verifyOk = true;

  // Signup and resend name the destination where Supabase reads it: the query string.
  calls.length = 0;
  await invoke(signup, { email: "person@example.com", password: "a-long-enough-password", emailRedirectTo: "https://redaxa.getcertsprint.com/" });
  assert.equal(new URL(calls[0].url).searchParams.get("redirect_to"), "https://redaxa.getcertsprint.com/");
  await invoke(signup, { email: "person@example.com", resend: true, emailRedirectTo: "https://attacker.example/" });
  assert.equal(new URL(calls[1].url).searchParams.get("redirect_to"), null, "foreign destinations are dropped");

  // Reset by hash: the password is checked before the link is spent.
  calls.length = 0;
  const short = await invoke(recover, { token_hash: hash, password: "short" }, { action: "finish" });
  assert.equal(short.status, 400);
  assert.equal(calls.length, 0, "a rejected password must not spend the link");
  const reset = await invoke(recover, { token_hash: hash, password: "a-long-enough-password" }, { action: "finish" });
  assert.equal(reset.status, 200);
  assert.deepEqual(calls[0].body, { type: "recovery", token_hash: hash });
  const update = calls.find(call => call.url.endsWith("/auth/v1/user") && call.method === "PUT");
  assert.equal(update?.auth, "Bearer verified-access");
  assert.ok(calls.some(call => call.url.endsWith("/auth/v1/logout?scope=global")), "a reset signs every session out");
  verifyOk = false;
  assert.equal((await invoke(recover, { token_hash: hash, password: "a-long-enough-password" }, { action: "finish" })).status, 400);
  verifyOk = true;
  weakPassword = true;
  const weak = await invoke(recover, { token_hash: hash, password: "a-long-enough-password" }, { action: "finish" });
  assert.equal(weak.status, 400);
  assert.match(String(weak.result.error), /Request a new link/);
  weakPassword = false;
  // A bare access token is not a recovery link: any session could change the password with it.
  calls.length = 0;
  assert.equal((await invoke(recover, { access_token: "any-session-access", password: "a-long-enough-password" }, { action: "finish" })).status, 400);
  assert.equal(calls.some(call => call.url.endsWith("/auth/v1/user")), false, "nothing is written without a verified recovery hash");
  assert.equal((await invoke(recover, { password: "a-long-enough-password" }, { action: "finish" })).status, 400);

  // The shared counter limits every instance, not only this one's memory.
  sharedLimited = true;
  calls.length = 0;
  assert.equal((await invoke(recover, { token_hash: hash, password: "a-long-enough-password" }, { action: "finish" })).status, 429);
  assert.equal(calls.length, 0, "a limited reset does not spend the link");
  sharedLimited = false;

  // Requesting a reset names the destination in the query string and never reveals whether the account exists.
  calls.length = 0;
  const requested = await invoke(recover, { email: "person@example.com", redirect_to: "https://redaxa.getcertsprint.com/" });
  assert.equal(requested.status, 200);
  assert.equal(new URL(calls[0].url).searchParams.get("redirect_to"), "https://redaxa.getcertsprint.com/");

  assert.equal(signinError(400, "invalid_credentials"), "Incorrect email or password.");
  assert.match(signinError(400, "email_not_confirmed"), /Confirm your email address first/);
  assert.match(signinError(429, undefined), /Too many attempts/);
  assert.match(signinError(503, undefined), /not available/);
  console.log("Email links: hash confirmation without a session, scanner-safe reset with global sign-out, bare access tokens refused and query-string destinations passed.");
} finally { globalThis.fetch = originalFetch; }
