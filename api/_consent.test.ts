import assert from "node:assert/strict";

// The Terms box before Stripe (api/_consent.ts). Nothing here reaches the
// network: fetch (Supabase) and the Stripe methods used are replaced.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";
process.env.STRIPE_PRICE_PERSONAL_MONTHLY = "price_pro_monthly_fixture";
process.env.STRIPE_PRICE_PERSONAL_YEARLY = "price_pro_yearly_fixture";
process.env.STRIPE_PRICE_BUSINESS_MONTHLY = "price_biz_monthly_fixture";
process.env.STRIPE_PRICE_BUSINESS_YEARLY = "price_biz_yearly_fixture";
process.env.APP_URL = "https://redaxa.getcertsprint.com";
process.env.CRON_SECRET = "cron-fixture-secret-0123456789";
process.env.STRIPE_PORTAL_CONFIGURATION = "bpc_fixture";
process.env.TRIAL_ENABLED = "true";
delete process.env.PROMO_ID;
delete process.env.CHECKOUT_CONSENT;

const consent = await import("./_consent.js");
const { stripe } = await import("./_billing.js");
const { trialMail } = await import("./_trial-email.js");
const { default: billing } = await import("./billing.js");

// --- The sealed link: readable only by us, unalterable, an hour long.
const intent = { user: "u1", email: "ana@example.test", plan: "personal" as const, interval: "yearly" as const, seats: 1, startTrial: true, lang: "de" as const, oldApp: false, app: "https://redaxa.getcertsprint.com" };
const token = consent.sealIntent(intent, 1_000);
assert.ok(!token.includes("ana") && /^[A-Za-z0-9_-]+$/.test(token), "the email is not readable in the link");
assert.equal(consent.openIntent(token, 2_000)?.email, "ana@example.test");
assert.equal(consent.openIntent(token, 1_000 + 60 * 60_000 + 1), null, "expired after an hour");
const raw = Buffer.from(token, "base64url");
raw[raw.length - 1] ^= 1;
assert.equal(consent.openIntent(raw.toString("base64url"), 2_000), null, "altered");
assert.equal(consent.openIntent(Buffer.concat([raw.subarray(0, 16), raw.subarray(28)]).toString("base64url"), 2_000), null, "truncated tag");
assert.equal(consent.openIntent(undefined), null);

assert.equal(consent.userAgentFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0"), "Edge/Windows");
assert.equal(consent.userAgentFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari/iOS");
assert.equal(consent.userAgentFamily(undefined), "Other/Other");
assert.equal(consent.consentCutoff(Date.parse("2026-11-03T10:00:00Z")), "2025-10-03T10:00:00.000Z", "13 months");

// The version stored on every row: the box text below with the terms.html it links to.
assert.equal(consent.TERMS_VERSION, "2026-11-04");

// --- The box says exactly what the owner approved (4 Nov 2026): one line, the Terms and immediate access.
const box = (lang: keyof typeof consent.CONSENT_COPY) => { const c = consent.CONSENT_COPY[lang]; return `${c.before}${c.terms}${c.after}`; };
assert.equal(box("en"), "I agree to the Terms and want access now, ending my 14-day right of withdrawal.");
assert.equal(box("de"), "Ich stimme den Nutzungsbedingungen zu und möchte sofort Zugang – damit endet mein 14-tägiges Widerrufsrecht.");
assert.equal(box("it"), "Accetto i Termini e voglio accedere subito, perdendo così il mio diritto di recesso di 14 giorni.");
assert.equal(box("es"), "Acepto los Términos y quiero acceder ya, con lo que termina mi derecho de desistimiento de 14 días.");
assert.equal(box("fr"), "J’accepte les Conditions d’utilisation et je veux l’accès immédiat, ce qui met fin à mon droit de rétractation de 14 jours.");
const keys = (value: object): string[] => Object.entries(value).flatMap(([k, v]) => typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k]).sort();
for (const lang of Object.keys(consent.CONSENT_COPY) as Array<keyof typeof consent.CONSENT_COPY>) {
  assert.deepEqual(keys(consent.CONSENT_COPY[lang]), keys(consent.CONSENT_COPY.en), lang);
  const values = (value: object): string[] => Object.values(value).flatMap((v) => typeof v === "object" ? values(v) : [String(v)]);
  const text = values(consent.CONSENT_COPY[lang]).join("\n");
  assert.doesNotMatch(text, /illustrat|\bSie\b|\bIhr\b/, lang);
  if (lang === "fr") assert.doesNotMatch(text, /(?<![\u00a0\u202f])[:;!?]/, "French spacing");
}

// --- Fakes for Supabase (REST) and Stripe.
type Row = Record<string, unknown>;
const calls: Array<{ method: string; url: string; body?: Row }> = [];
const consents = new Map<string, Row>();
let refusal: string | null = null;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) as Row : undefined;
  calls.push({ method, url, body });
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  if (url.endsWith("/auth/v1/user")) {
    const id = String((init?.headers as Record<string, string>)?.Authorization ?? "").replace(/^Bearer /, "");
    return id === "u1" ? json({ id: "u1", email: "ana@example.test" }) : json({}, 401);
  }
  if (url.includes("/rpc/reserve_billing_checkout")) {
    if (refusal) return json({ message: refusal }, 400);
    return json({ user_id: "u1", stripe_customer_id: "cus_fixture", stripe_subscription_id: null, has_used_trial: false, subscription_status: null });
  }
  if (url.includes("/rpc/redaxa_trial_available")) return json(true);
  if (url.includes("/rest/v1/checkout_consents")) {
    if (method === "POST") { consents.set(String(body!.id), { ...body }); return new Response(null, { status: 201 }); }
    if (method === "PATCH") { Object.assign(consents.get(decodeURIComponent(/id=eq\.([^&]+)/.exec(url)![1]))!, body); return new Response(null, { status: 204 }); }
    if (method === "DELETE") return new Response(null, { status: 204 });
  }
  if (url.includes("/rest/v1/")) return method === "GET" ? json([]) : new Response(null, { status: 204 });
  throw new Error(`unexpected fetch ${method} ${url}`);
}) as typeof fetch;

const sessions: Row[] = [];
const s = stripe as any;
s.checkout.sessions.create = async (params: Row) => { sessions.push(params); calls.push({ method: "STRIPE", url: "checkout.sessions.create" }); return { id: `cs_test_${sessions.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${sessions.length}` }; };
s.checkout.sessions.list = async () => ({ data: [] });
s.customers.create = async () => ({ id: "cus_fixture" });
s.events.list = () => (async function* () { /* no failed payments */ })();

function response() {
  return { statusCode: 0, headers: {} as Record<string, unknown>, body: undefined as any,
    setHeader(name: string, value: unknown) { this.headers[name.toLowerCase()] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; }, end(body?: string) { this.body = body; } };
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
async function plan(origin = "https://redaxa.getcertsprint.com", extra: Row = {}) {
  const res = response();
  await billing({ method: "POST", body: { plan: "personal", interval: "yearly", start_trial: true, language: "de", ...extra }, headers: { authorization: "Bearer u1", origin, "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }, res as any);
  return res;
}
async function page(t: string | undefined) {
  const res = response();
  await billing({ method: "GET", query: { action: "consent", ...(t ? { t } : {}) }, headers: {} }, res as any);
  return res;
}
async function submit(form: Row, origin = "https://redaxa.getcertsprint.com") {
  const res = response();
  await billing({ method: "POST", query: { action: "consent" }, body: form, headers: { origin, "user-agent": UA, "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }, res as any);
  return res;
}

// --- Switch off: checkout exactly as before, straight to Stripe, no consent fields.
{
  const res = await plan();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(res.body.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(sessions.length, 1);
  assert.equal((sessions[0].metadata as Row).consent_id, undefined);
}

// --- Switch on: every client gets our page instead, and no session exists yet.
process.env.CHECKOUT_CONSENT = "required";
{
  const before = sessions.length;
  const res = await plan();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(res.body.url, /^https:\/\/redaxa\.getcertsprint\.com\/checkout\?t=[A-Za-z0-9_-]+$/);
  assert.equal(sessions.length, before, "no Stripe session before the box");
  // The Windows app (any version) gets the same page on the web origin.
  const desktop = await plan("https://tauri.localhost");
  assert.match(desktop.body.url, /^https:\/\/redaxa\.getcertsprint\.com\/checkout\?t=/);
  // The refusals the apps already handle still come back to them, before the page.
  refusal = "Account needs attention before a new checkout";
  const blocked = await plan();
  refusal = null;
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.code, "manage_billing");

  const t = new URL(res.body.url).searchParams.get("t")!;
  const shown = await page(t);
  assert.equal(shown.statusCode, 200);
  assert.equal(shown.headers["cache-control"], "no-store");
  assert.match(shown.body, /<html lang="de">/);
  assert.match(shown.body, /<span>Ich stimme den <a href="[^"]+\/terms\.html" target="_blank" rel="noopener">Nutzungsbedingungen<\/a> zu und möchte sofort Zugang – damit endet mein 14-tägiges Widerrufsrecht\.<\/span><\/label>/);
  assert.match(shown.body, /<label class="consent" id="consent-box"><input type="checkbox" name="agree" value="yes" id="agree" aria-describedby="consent-error">/);
  assert.match(shown.body, /Pro — Jährlich/);
  assert.match(shown.body, /3-tägigen kostenlosen Test/);
  assert.match(shown.body, /<script src="\/checkout\.js" defer><\/script>/);
  assert.equal((shown.body.match(/<script\b[^>]*>/gi) ?? []).filter((tag) => !/\bsrc=/i.test(tag)).length, 0, "no inline script (CSP)");
  assert.equal((await page("forged-token-forged-token-forged-token-forged")).statusCode, 410);
  assert.equal((await page(undefined)).statusCode, 410);

  // Not ticked: the same page with the error, nothing stored, nothing created.
  const unticked = await submit({ t, terms: consent.TERMS_VERSION });
  assert.equal(unticked.statusCode, 422);
  assert.match(unticked.body, /class="consent err"/);
  assert.match(unticked.body, /aria-invalid="true" autofocus/);
  assert.match(unticked.body, /Setz das Häkchen, um fortzufahren\./);
  assert.equal(consents.size, 0);
  assert.equal(sessions.length, before);
  // Terms changed while the page was open.
  assert.equal((await submit({ t, terms: "2026-01-01", agree: "yes" })).statusCode, 409);
  // A foreign page relaying a valid link.
  assert.equal((await submit({ t, terms: consent.TERMS_VERSION, agree: "yes" }, "https://evil.example")).statusCode, 403);
  assert.equal(consents.size, 0);

  // Ticked: the row first, then the session that names it, then Stripe.
  calls.length = 0;
  const ok = await submit(`t=${t}&terms=${consent.TERMS_VERSION}&agree=yes` as unknown as Row);
  assert.equal(ok.statusCode, 303, String(ok.body));
  assert.match(String(ok.headers.location), /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
  const order = calls.map((c) => c.method === "STRIPE" ? "session" : c.url.includes("checkout_consents") ? `consent:${c.method}` : "").filter(Boolean);
  assert.deepEqual(order, ["consent:POST", "session", "consent:PATCH"]);
  const [row] = [...consents.values()];
  assert.equal(row.user_id, "u1");
  assert.equal(row.product, "redaxa");
  assert.equal(row.plan, "personal");
  assert.equal(row.billing_interval, "yearly");
  assert.equal(row.terms_version, consent.TERMS_VERSION);
  assert.equal(row.ip, "203.0.113.7", "the buyer's address, not a proxy's");
  assert.equal(row.user_agent_family, "Chrome/Windows");
  const session = sessions.at(-1)! as any;
  assert.equal(row.checkout_session_id, `cs_test_${sessions.length}`);
  for (const metadata of [session.metadata, session.subscription_data.metadata]) {
    assert.equal(metadata.consent_id, row.id);
    assert.equal(metadata.terms_version, consent.TERMS_VERSION);
    assert.equal(metadata.lang, "de");
  }
  assert.equal(session.subscription_data.trial_period_days, 3);
  assert.equal(session.success_url, "https://redaxa.getcertsprint.com/?checkout=success&lang=de");

  // A refusal after the tick is said on the page, in the customer's language.
  refusal = "An active subscription already exists";
  const active = await submit({ t, terms: consent.TERMS_VERSION, agree: "yes" });
  refusal = null;
  assert.equal(active.statusCode, 409);
  assert.match(active.body, /Dieses Konto hat bereits einen aktiven Tarif\./);
}

// --- The first email of a subscription that went through the box says so; others do not.
{
  const base = { to: "ana@example.test", lang: "de" as const, plan: "personal", interval: "yearly", seats: 1, days: 3, trialEnd: 1_800_000_000, charge: { amount: 3995, currency: "eur" } };
  assert.match(trialMail("trial_started", { ...base, consented: true }).text, /Widerrufsrecht damit erlischt/);
  assert.doesNotMatch(trialMail("trial_started", base).text, /Widerrufsrecht/);
  assert.match(trialMail("subscription_started", { ...base, lang: "en", consented: true }).text, /your 14-day right of withdrawal ends once access starts/);
  assert.doesNotMatch(trialMail("trial_ending", { ...base, consented: true }).text, /Widerrufsrecht damit erlischt/);
}

// --- The cron sweep deletes rows older than 13 months.
{
  calls.length = 0;
  const res = response();
  await billing({ method: "GET", headers: { "x-vercel-cron-schedule": "0 7 * * *", authorization: `Bearer ${process.env.CRON_SECRET}` } }, res as any);
  assert.equal(res.body.consentsPurged, true, JSON.stringify(res.body));
  assert.ok(calls.some((c) => c.method === "DELETE" && /checkout_consents\?accepted_at=lt\.\d{4}-/.test(c.url)));
}

console.log("consent checks passed: sealed link, approved box text in 5 languages, row before session, metadata, email line, 13-month purge.");
