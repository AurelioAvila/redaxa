import { authRedirectUrl, corsHeaders, supabaseAuthUser } from "../_billing.js";
import { clientIp, rateLimited } from "../_rateLimit.js";
import { sendPasswordChangedEmail } from "../_email.js";

type RequestLike = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

/** Matches the minimum the signup form enforces, so a reset cannot be used to
 *  get around it. */
const minPasswordLength = 12;

/**
 * Finishes a reset: sets the new password, then says so.
 *
 * Folded into this file rather than given one of its own because the project
 * sits at Vercel's cap of twelve functions, and this is the other half of the
 * same flow.
 *
 * The update is made with the caller's own recovery token, never the service
 * role. Supabase then decides whether that token is valid and of the right
 * kind, which is a check we would otherwise be reimplementing — and getting
 * wrong here would mean anyone could set anyone's password.
 *
 * Routing the change through here rather than letting the browser call
 * Supabase directly is what makes the notice trustworthy: it is sent only
 * after a change that actually happened.
 */
async function finishReset(request: RequestLike, response: ResponseLike): Promise<void> {
  const body = (request.body ?? {}) as { access_token?: unknown; token_hash?: unknown; password?: unknown };
  const legacyToken = typeof body.access_token === "string" ? body.access_token : "";
  const tokenHash = typeof body.token_hash === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(body.token_hash) ? body.token_hash : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!legacyToken && !tokenHash) { response.status(400).json({ error: "This link is no longer valid. Request a new one." }); return; }
  // Checked before the one-time link is spent, so a rejected password does not cost the link.
  if (password.length < minPasswordLength) {
    response.status(400).json({ error: `Use a password with at least ${minPasswordLength} characters.` });
    return;
  }
  if (rateLimited(`reset:ip:${clientIp(request.headers)}`, 10, 15 * 60_000)) {
    response.status(429).json({ error: "Too many attempts. Please wait a few minutes." });
    return;
  }

  const url = required("SUPABASE_URL").replace(/\/$/, "");
  const publishable = required("SUPABASE_PUBLISHABLE_KEY");
  // Current links carry a one-time hash that only becomes a session here, after
  // the reader typed a new password: a mail scanner fetching the link spends
  // nothing. Older links (sent before this change) still arrive as a token.
  let accessToken = legacyToken;
  if (tokenHash) {
    const verified = await fetch(`${url}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: publishable, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "recovery", token_hash: tokenHash }),
      signal: AbortSignal.timeout(15_000),
    });
    const session = await verified.json().catch(() => ({})) as { access_token?: string };
    if (!verified.ok || !session.access_token) {
      response.status(400).json({ error: "This reset link has expired or was already used. Request a new one." });
      return;
    }
    accessToken = session.access_token;
  }

  // Resolved before the update so the notice has an address even though the
  // update's own response also carries one — and so an invalid token is
  // refused before anything is written.
  const user = await supabaseAuthUser(accessToken);
  if (!user) { response.status(401).json({ error: "This link is no longer valid. Request a new one." }); return; }

  const updated = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publishable,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });
  if (!updated.ok) {
    const problem = await updated.json().catch(() => ({})) as { error_code?: string; code?: string; msg?: string };
    const weak = (problem.error_code ?? problem.code) === "weak_password";
    response.status(400).json({ error: weak ? `${problem.msg ?? "That password is too weak."} Request a new link and choose a stronger one.` : "We could not set that password. Request a new link and try again." });
    return;
  }

  // A reset is how an account is taken back: every session that existed before
  // it ends, including the one this link created. Best-effort, like the notice.
  await fetch(`${url}/auth/v1/logout?scope=global`, {
    method: "POST",
    headers: { apikey: publishable, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);

  // Best-effort, and after the fact. The password has already changed, so
  // failing the request now would tell someone their reset did not work when
  // it did — leaving them with a password they do not know they have.
  const firstName = typeof user.metadata?.first_name === "string" ? user.metadata.first_name : null;
  await sendPasswordChangedEmail(user.email, firstName).catch(() => undefined);

  response.status(200).json({ ok: true });
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }

  // Two halves of one flow: ask for a link, then use it.
  const action = (request as { query?: Record<string, string | string[] | undefined> }).query?.action;
  if ((Array.isArray(action) ? action[0] : action) === "finish") {
    try {
      await finishReset(request, response);
    } catch {
      response.status(500).json({ error: "We could not complete that request." });
    }
    return;
  }

  try {
    const body = (request.body ?? {}) as { email?: unknown; redirect_to?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email) { response.status(400).json({ error: "Enter your email address." }); return; }
    const ip = clientIp(request.headers);
    if (rateLimited(`recover:ip:${ip}`, 10, 15 * 60_000) || rateLimited(`recover:email:${email.toLowerCase()}`, 3, 15 * 60_000)) {
      response.status(200).json({ ok: true });
      return;
    }
    const url = required("SUPABASE_URL").replace(/\/$/, "");
    const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
    // Supabase takes the link destination from the query string; the body copy is ignored.
    const redirect = authRedirectUrl(body.redirect_to);
    await fetch(`${url}/auth/v1/recover${redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : ""}`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirect_to: redirect })
    });
    // Always report success so this endpoint cannot be used to enumerate registered emails.
    response.status(200).json({ ok: true });
  } catch {
    response.status(200).json({ ok: true });
  }
}
