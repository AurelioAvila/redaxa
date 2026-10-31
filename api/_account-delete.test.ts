import assert from "node:assert/strict";

// Nothing here reaches the network: fetch is mocked, and so are the Stripe
// calls, on the one client every API module shares.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.RESEND_API_KEY = "re_test";
process.env.REDAXA_MAIL_FROM = "Redaxa <noreply@example.test>";
delete process.env.EMAIL_SINK;

const { default: handler } = await import("./account.js");
const { stripe } = await import("./_billing.js");
const { ACCOUNT_DELETED } = await import("./_account-delete.js");
const { accountDeletedHtml, accountDeletedText } = await import("./_email.js");

const userId = "00000000-0000-0000-0000-0000000000aa";
const ownerId = "00000000-0000-0000-0000-0000000000bb";
const email = "Ada@Example.test";
const site = "https://redaxa.getcertsprint.com";
let ip = 0;
// The per-account limit (5 an hour) would stop these tests long before they
// end: every call starts an hour after the previous one, unless it says not to.
let clock = Date.now();
Date.now = () => clock;

type Step = string;
type World = {
  frameWitness?: (init?: RequestInit) => Response;
  rpc?: () => Response;
  subscriptions?: Array<{ id: string; status: string; metadata: Record<string, string> }>;
  stripeFails?: boolean;
  workspaceOwner?: string | null;
};

/** One request through the real handler. Returns the response and every
 *  outside call, in order, so the tests can check what ran and when. */
async function call(options: { body?: unknown; headers?: Record<string, string>; method?: string; world?: World; sameHour?: boolean } = {}) {
  if (!options.sameHour) clock += 60 * 60_000 + 1;
  const world = options.world ?? {};
  const steps: Step[] = [];
  const mails: Array<{ to: string; subject: string; text: string; html: string }> = [];
  const cancelled: Array<{ id: string; params: unknown }> = [];
  const expired: string[] = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (url === "https://example.supabase.co/auth/v1/user") {
      return ["Bearer session-token", "Bearer cookie-token"].includes(String(auth)) ? Response.json({ id: userId, email }) : new Response("{}", { status: 401 });
    }
    if (url.startsWith("https://frame-witness-forensics.pages.dev/")) {
      steps.push("frame-witness");
      assert.equal(url, "https://frame-witness-forensics.pages.dev/api/commerce/licenses");
      assert.ok(["Bearer session-token", "Bearer cookie-token"].includes(String(auth)), "Frame Witness is asked with the customer's own session");
      return world.frameWitness ? world.frameWitness(init) : Response.json({ orders: [], trial: null });
    }
    if (url.endsWith("/rest/v1/rpc/rate_limit_hit")) return Response.json(false);
    if (url.includes("/rest/v1/billing_accounts?user_id=")) return Response.json([{ stripe_customer_id: "cus_ada", stripe_subscription_id: "sub_old" }]);
    if (url.endsWith("/rest/v1/rpc/delete_redaxa_account")) {
      steps.push("rpc");
      assert.deepEqual(JSON.parse(String(init?.body)), { p_user_id: userId });
      return world.rpc ? world.rpc() : Response.json(world.workspaceOwner ?? null);
    }
    if (url === `https://example.supabase.co/auth/v1/admin/users/${userId}`) {
      steps.push(`auth ${method}${init?.body ? ` ${init.body}` : ""}`);
      return Response.json({});
    }
    if (url === `https://example.supabase.co/auth/v1/admin/users/${ownerId}`) return Response.json({ email: "owner@example.test" });
    if (url.includes(`/rest/v1/organizations?owner_user_id=eq.${ownerId}`)) return Response.json([{ id: "org", name: "Acme", owner_user_id: ownerId, created_at: "2026-10-01" }]);
    if (url === "https://example.supabase.co/auth/v1/logout?scope=global") {
      steps.push("logout global");
      assert.equal(auth, "Bearer session-token");
      return new Response(null, { status: 204 });
    }
    if (url === "https://api.resend.com/emails") {
      const mail = JSON.parse(String(init?.body));
      steps.push(`mail ${mail.to}`);
      mails.push(mail);
      return Response.json({ id: "mail" });
    }
    throw new Error(`unexpected call ${method} ${url}`);
  }) as typeof fetch;
  const saved = {
    list: stripe.subscriptions.list, cancel: stripe.subscriptions.cancel,
    sessions: stripe.checkout.sessions.list, expire: stripe.checkout.sessions.expire,
  };
  Object.assign(stripe.subscriptions, {
    list: async (params: { customer: string }) => {
      steps.push("stripe list");
      if (world.stripeFails) throw new Error("Stripe is down");
      assert.equal(params.customer, "cus_ada");
      return { data: world.subscriptions ?? [] };
    },
    cancel: async (id: string, params: unknown) => { steps.push(`stripe cancel ${id}`); cancelled.push({ id, params }); return { id, status: "canceled" }; },
  });
  Object.assign(stripe.checkout.sessions, {
    list: async () => ({ data: [{ id: "cs_ours", metadata: { redaxa_user_id: userId } }, { id: "cs_other", metadata: {} }] }),
    expire: async (id: string) => { steps.push(`stripe expire ${id}`); expired.push(id); return { id }; },
  });
  const response = {
    code: 0, payload: undefined as unknown, headers: {} as Record<string, string | string[]>,
    setHeader(name: string, value: string | string[]) { this.headers[name] = value; },
    status(code: number) { this.code = code; return this; },
    json(value: unknown) { this.payload = value; }, end() {},
  };
  try {
    await handler({
      method: options.method ?? "POST",
      query: { action: "delete" },
      body: options.body ?? { email: " ada@example.TEST " },
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ip++}`, ...(options.headers ?? { authorization: "Bearer session-token" }) },
    }, response);
  } finally {
    globalThis.fetch = savedFetch;
    Object.assign(stripe.subscriptions, { list: saved.list, cancel: saved.cancel });
    Object.assign(stripe.checkout.sessions, { list: saved.sessions, expire: saved.expire });
  }
  return { ...response, steps, mails, cancelled, expired };
}

const destructive = (steps: Step[]) => steps.filter((step) => /^(stripe|rpc|auth|logout|mail)/.test(step));

// Forged or malformed requests do nothing at all.
{
  assert.equal((await call({ method: "GET" })).code, 405);
  const notJson = await call({ headers: { authorization: "Bearer session-token", "content-type": "text/plain" } });
  assert.equal(notJson.code, 415);
  // A cookie session needs the site's own Origin: none at all, or a sibling
  // getcertsprint.com page (same-site, so the cookies would ride along), is refused.
  for (const origin of [undefined, "https://evil.getcertsprint.com", "https://tauri.localhost"]) {
    const forged = await call({ headers: { cookie: "ps_at=cookie-token", ...(origin ? { origin } : {}) } });
    assert.equal(forged.code, 403, `cookie session from ${origin ?? "no origin"}`);
    assert.deepEqual(destructive(forged.steps), []);
  }
  // A Bearer token from another site is refused too.
  assert.equal((await call({ headers: { authorization: "Bearer session-token", origin: "https://evil.example" } })).code, 403);
  // Signed out, or a Scan API key: not allowed to delete anything.
  assert.equal((await call({ headers: { origin: site } })).code, 401);
  const apiKey = await call({ headers: { authorization: "Bearer psk_live_0123456789abcdef" } });
  assert.equal(apiKey.code, 401);
  assert.deepEqual(destructive(apiKey.steps), []);
  // The address must be typed: a missing or different one changes nothing.
  for (const body of [{}, { email: "someone@else.test" }, { email: 42 }]) {
    const unconfirmed = await call({ body });
    assert.equal(unconfirmed.code, 400);
    assert.equal((unconfirmed.payload as { code?: string }).code, "confirm_email");
    assert.deepEqual(unconfirmed.steps, []);
  }
}

// The whole deletion, in order: Frame Witness is asked first, billing ends
// before any data goes, then the rows, then the sign-in, then one email.
{
  const done = await call({
    headers: { cookie: "ps_at=cookie-token", origin: site },
    world: { subscriptions: [
      { id: "sub_live", status: "trialing", metadata: { redaxa_user_id: userId } },
      { id: "sub_old", status: "past_due", metadata: {} },
      { id: "sub_done", status: "canceled", metadata: { redaxa_user_id: userId } },
      { id: "sub_other_product", status: "active", metadata: { product: "pctweaker" } },
    ] },
  });
  assert.equal(done.code, 200);
  assert.deepEqual(done.payload, { ok: true, signInKept: false, subscriptionsEnded: 2 });
  assert.deepEqual(done.steps, [
    "frame-witness", "stripe list", "stripe cancel sub_live", "stripe cancel sub_old", "stripe expire cs_ours",
    "rpc", "auth DELETE", `mail ${email}`,
  ]);
  // Immediately, with no proration and no final invoice: nothing refunded, nothing more charged.
  for (const { params } of done.cancelled) assert.deepEqual(params, { prorate: false, invoice_now: false, cancellation_details: { comment: ACCOUNT_DELETED } });
  assert.deepEqual(done.expired, ["cs_ours"]);
  // The browser's session cookies are cleared.
  assert.ok(String(done.headers["Set-Cookie"]).includes("ps_at=;") && String(done.headers["Set-Cookie"]).includes("Max-Age=0"));
  const [mail] = done.mails;
  assert.equal(mail.subject, "Your Redaxa account has been deleted");
  assert.match(mail.text, /Ended immediately\. Nothing more will be charged\./);
  assert.match(mail.text, /Sign-in: Deleted\./);
  assert.doesNotMatch(mail.text, /Frame Witness/);
  assert.doesNotMatch(mail.text + mail.html, /refund/i);
  assert.ok(!mail.html.includes("<a href"), "the notice carries nothing clickable");
}

// Frame Witness holds a licence for this sign-in: the Redaxa side goes, the
// sign-in stays, every session ends and the email says why.
{
  const kept = await call({ world: { frameWitness: () => Response.json({ orders: [{ id: "o1" }], trial: null }) } });
  assert.equal(kept.code, 200);
  assert.deepEqual(kept.payload, { ok: true, signInKept: true, subscriptionsEnded: 0 });
  assert.deepEqual(kept.steps, [
    "frame-witness", "stripe list", "stripe expire cs_ours", "rpc", "logout global",
    `auth PUT ${JSON.stringify({ user_metadata: { welcomed_at: null } })}`, `mail ${email}`,
  ]);
  assert.match(kept.mails[0].text, /Sign-in: Kept, because Frame Witness uses it\./);
  assert.match(kept.mails[0].text, /Subscription: None was running\./);
  // A running Frame Witness trial counts too.
  const trial = await call({ world: { frameWitness: () => Response.json({ orders: [], trial: { ends_at: "2026-11-01T00:00:00Z", running: true } }) } });
  assert.equal((trial.payload as { signInKept?: boolean }).signInKept, true);
}

// A member of someone else's workspace: the owner hears the seat is free.
{
  const member = await call({ world: { workspaceOwner: ownerId } });
  assert.equal(member.code, 200);
  assert.deepEqual(member.mails.map((m) => [m.to, m.subject]), [
    ["owner@example.test", "A teammate left your Redaxa workspace"],
    [email, "Your Redaxa account has been deleted"],
  ]);
}

// Any failure before the rows go leaves the account as it was, and says so.
{
  for (const reply of [() => new Response("{}", { status: 503 }), () => Response.json({ unexpected: true }), () => { throw new Error("offline"); }]) {
    const unsure = await call({ world: { frameWitness: reply } });
    assert.equal(unsure.code, 503);
    assert.deepEqual(destructive(unsure.steps), [], "nothing is deleted on a guess");
  }
  // Frame Witness never confirmed this address, so it holds nothing for it.
  assert.equal((await call({ world: { frameWitness: () => new Response("{}", { status: 401 }) } })).code, 200);
  const billing = await call({ world: { stripeFails: true } });
  assert.equal(billing.code, 502);
  assert.deepEqual(billing.steps, ["frame-witness", "stripe list"]);
  const storage = await call({ world: { rpc: () => new Response("{}", { status: 500 }) } });
  assert.equal(storage.code, 500);
  assert.ok(!storage.steps.some((step) => step.startsWith("auth") || step.startsWith("mail")), "the sign-in stays until the rows are gone");
}

// Five attempts an hour per account, whatever the address typed.
{
  const codes: number[] = [];
  for (let i = 0; i < 6; i += 1) codes.push((await call({ body: { email: "wrong@example.test" }, sameHour: i > 0 })).code);
  assert.deepEqual(codes, [400, 400, 400, 400, 400, 429]);
}

// The email reads well with and without a subscription, and in both sign-in cases.
{
  const html = accountDeletedHtml({ email: "a&b@example.test", when: "31 October 2026 at 17:00 UTC", cancelled: 1, signInKept: true });
  assert.ok(html.includes("a&amp;b@example.test"), "the address is escaped");
  const text = accountDeletedText({ email: "a@example.test", when: "31 October 2026 at 17:00 UTC", cancelled: 0, signInKept: false });
  assert.match(text, /Invoices: Kept by Stripe, our payment processor, for as long as tax law requires\./);
  assert.match(text, /Prompt text was never stored/);
  assert.doesNotMatch(text, /illustrat|refund/i);
}

console.log("Account deletion: CSRF, confirmation, order of steps, Frame Witness sign-in, billing without refund, rate limit and the email passed.");
