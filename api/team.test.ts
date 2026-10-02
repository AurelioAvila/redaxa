import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
const { default: handler } = await import("./team.js");
const owner = "00000000-0000-0000-0000-000000000001";
const member = "00000000-0000-0000-0000-000000000002";
const token = "a".repeat(32);
const invite = { id: "00000000-0000-0000-0000-000000000003", owner_user_id: owner, token, status: "pending" };
let requestCount = 0;

async function call(method: string, action: string, body: Record<string, unknown>, database: (url: string, init?: RequestInit) => Response | Promise<Response>, authenticated = true) {
  const savedFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: member, email: "member@example.test" });
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-service-key");
    return database(url, init);
  }) as typeof fetch;
  const response = {
    code: 0, payload: undefined as unknown, headers: {} as Record<string, string | string[]>,
    setHeader(name: string, value: string | string[]) { this.headers[name] = value; },
    status(code: number) { this.code = code; return this; },
    json(value: unknown) { this.payload = value; }, end() {}
  };
  try {
    await handler({ method, query: { action, token }, body, headers: authenticated ? { authorization: "Bearer fixture", "x-forwarded-for": `test-${requestCount++}` } : {} }, response);
  } finally { globalThis.fetch = savedFetch; }
  return { ...response, calls };
}

// Verified identities are read server-side, and preview never mutates state.
const preview = await call("GET", "preview", { inviter: { email: "forged@example.test" } }, (url, init) => {
  assert.equal(init?.method, "GET");
  if (url.includes("/team_invites?")) return Response.json([invite]);
  if (url.includes("/billing_accounts?")) return Response.json([{ plan: "business", subscription_status: "active" }]);
  if (url.includes("/auth/v1/admin/users/")) return Response.json({ email: "verified@example.test" });
  if (url.includes("/organizations?")) return Response.json([{ id: "org", name: "Verified workspace" }]);
  throw new Error(url);
});
assert.equal(preview.code, 200);
assert.equal(preview.headers["Cache-Control"], "no-store");
assert.deepEqual(preview.payload, { inviter: { email: "verified@example.test" }, organization: { id: "org", name: "Verified workspace" } });
assert.equal((await call("GET", "preview", {}, () => { throw new Error("No DB access"); }, false)).code, 401);
assert.equal((await call("GET", "preview", {}, () => Response.json([{ ...invite, status: "revoked" }]))).code, 410);
assert.equal((await call("GET", "preview", {}, url => url.includes("/team_invites?") ? Response.json([invite]) : url.includes("/billing_accounts?") ? Response.json([{ plan: "business", subscription_status: "active" }]) : Response.json({}, { status: 503 }))).code, 500);

for (const [message, expected] of [["TEAM_FULL", 409], ["TEAM_PLAN_REQUIRED", 403], ["TEAM_SELF", 400], ["TEAM_MEMBERSHIP_CONFLICT", 409], ["internal provider detail", 500]] as const) {
  const result = await call("POST", "accept", { token }, url => {
    assert.ok(url.endsWith("/rpc/accept_team_invite"));
    return Response.json({ message }, { status: 400 });
  });
  assert.equal(result.code, expected);
  assert.ok(!JSON.stringify(result.payload).includes("internal provider detail"));
}
assert.equal((await call("POST", "accept", { token }, () => Response.json(null))).code, 410);
assert.equal((await call("POST", "accept", { token }, () => Response.json({ id: null, token: null, status: null, member_user_id: null }))).code, 410);
assert.equal((await call("POST", "accept", { token }, () => Response.json({ ...invite, status: "accepted", member_user_id: owner }))).code, 500);
const accepted = await call("POST", "accept", { token }, (url, init) => {
  assert.ok(url.endsWith("/rpc/accept_team_invite"));
  assert.deepEqual(JSON.parse(String(init?.body)), { p_token: token, p_member_user_id: member });
  return Response.json({ ...invite, status: "accepted", member_user_id: member });
});
assert.equal(accepted.code, 200);
assert.equal(accepted.calls.filter(url => !url.endsWith("/auth/v1/user")).length, 1);
for (const found of [false, true]) {
  const revoked = await call("POST", "revoke", { inviteId: invite.id }, (url, init) => {
    assert.ok(url.endsWith("/rpc/revoke_team_invite"));
    assert.deepEqual(JSON.parse(String(init?.body)), { p_owner_user_id: member, p_invite_id: invite.id });
    return Response.json(found);
  });
  assert.equal(revoked.code, found ? 200 : 404);
}
assert.equal((await call("POST", "revoke", { inviteId: invite.id }, () => Response.json({ revoked: true }))).code, 500);
assert.equal((await call("POST", "create", {}, () => Response.json({ ...invite, status: "accepted" }))).code, 500);
const created = await call("POST", "create", {}, (url, init) => {
  assert.ok(url.endsWith("/rpc/create_team_invite"));
  const value = JSON.parse(String(init?.body));
  assert.equal(value.p_owner_user_id, member);
  assert.match(value.p_token, /^[a-f0-9]{32}$/);
  return Response.json({ ...invite, owner_user_id: member, token: value.p_token });
});
assert.equal(created.code, 200);
console.log("Team API regressions passed.");
