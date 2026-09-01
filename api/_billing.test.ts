import assert from "node:assert/strict";

// Dummy values so module-level `required(...)` calls (e.g. the Stripe client
// constructor) succeed at import time. No network call is made with them here —
// every fetch is mocked below.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

const billing = await import("./_billing.js");

type Headers = Record<string, string | string[]>;
function mockResponse(): { setHeader(name: string, value: string | string[]): void; headers: Headers } {
  const headers: Headers = {};
  return { setHeader: (name, value) => { headers[name] = value; }, headers };
}

async function withMockFetch<T>(impl: (url: string, init?: RequestInit) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => impl(String(input), init)) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

function bearerToken(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization?.replace(/^Bearer /, "");
}

// parseCookies
assert.deepEqual(billing.parseCookies("ps_at=abc123; ps_rt=def%20456"), { ps_at: "abc123", ps_rt: "def 456" });
assert.deepEqual(billing.parseCookies(undefined), {});
assert.deepEqual(billing.parseCookies(""), {});
assert.deepEqual(billing.parseCookies(["ps_at=one", "ps_rt=two"]), { ps_at: "one", ps_rt: "two" });

// setSessionCookies sets both cookies as httpOnly + SameSite=Lax, access token expiry-bound
{
  const response = mockResponse();
  billing.setSessionCookies(response, "access-token", "refresh-token", 3600);
  const cookies = response.headers["Set-Cookie"] as string[];
  assert.equal(cookies.length, 3);
  assert.match(cookies[0], /^ps_at=access-token;.*HttpOnly/);
  assert.match(cookies[0], /SameSite=Lax/);
  assert.match(cookies[0], /Max-Age=3600/);
  assert.match(cookies[1], /^ps_rt=refresh-token;.*HttpOnly/);
  assert.match(cookies[2], /^ps_rem=1;.*HttpOnly/);
}

// setSessionCookies with remember=false issues session cookies (no Max-Age) instead
{
  const response = mockResponse();
  billing.setSessionCookies(response, "access-token", "refresh-token", 3600, false);
  const cookies = response.headers["Set-Cookie"] as string[];
  assert.equal(cookies.length, 3);
  for (const cookie of cookies) assert.ok(!cookie.includes("Max-Age"), `expected no Max-Age in: ${cookie}`);
}

// clearSessionCookies expires both cookies immediately
{
  const response = mockResponse();
  billing.clearSessionCookies(response);
  const cookies = response.headers["Set-Cookie"] as string[];
  assert.ok(cookies.every((cookie) => cookie.includes("Max-Age=0")));
}

// requireUser: a valid access-token cookie resolves the user with no refresh needed
await withMockFetch(
  async (url, init) => {
    assert.match(url, /\/auth\/v1\/user$/);
    assert.equal(bearerToken(init), "valid-token");
    return new Response(JSON.stringify({ id: "user-1", email: "person@example.com" }), { status: 200 });
  },
  async () => {
    const user = await billing.requireUser({ headers: { cookie: "ps_at=valid-token" } });
    assert.equal(user?.id, "user-1");
    assert.equal(user?.email, "person@example.com");
  }
);

// requireUser: desktop-style Authorization: Bearer header resolves the user
// directly, without needing (or touching) any cookie.
await withMockFetch(
  async (url, init) => {
    assert.match(url, /\/auth\/v1\/user$/);
    assert.equal(bearerToken(init), "bearer-token");
    return new Response(JSON.stringify({ id: "user-2", email: "desktop@example.com" }), { status: 200 });
  },
  async () => {
    const user = await billing.requireUser({ headers: { authorization: "Bearer bearer-token" } });
    assert.equal(user?.id, "user-2");
    assert.equal(user?.email, "desktop@example.com");
  }
);

// requireUser: expired access token + valid refresh token silently refreshes and rewrites cookies
await withMockFetch(
  async (url, init) => {
    if (url.includes("grant_type=refresh_token")) {
      return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("/auth/v1/user")) {
      const token = bearerToken(init);
      if (token === "expired-token") return new Response("", { status: 401 });
      if (token === "new-access") return new Response(JSON.stringify({ id: "user-1", email: "person@example.com" }), { status: 200 });
    }
    throw new Error(`Unexpected request in test: ${url}`);
  },
  async () => {
    const response = mockResponse();
    const user = await billing.requireUser({ headers: { cookie: "ps_at=expired-token; ps_rt=refresh-token" } }, response);
    assert.equal(user?.id, "user-1");
    assert.equal(user?.email, "person@example.com");
    const cookies = response.headers["Set-Cookie"] as string[];
    assert.match(cookies[0], /^ps_at=new-access;/);
  }
);

// requireUser: no cookies at all -> UNAUTHORIZED, no network call attempted
await withMockFetch(
  async (url) => { throw new Error(`No fetch expected, got: ${url}`); },
  async () => { await assert.rejects(() => billing.requireUser({ headers: {} }), /UNAUTHORIZED/); }
);

// requireUser: expired access token and no refresh token -> UNAUTHORIZED
await withMockFetch(
  async () => new Response("", { status: 401 }),
  async () => { await assert.rejects(() => billing.requireUser({ headers: { cookie: "ps_at=expired-token" } }), /UNAUTHORIZED/); }
);

console.log("Redaxa billing tests passed.");
