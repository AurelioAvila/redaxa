import { authRedirectUrl, corsHeaders, supabaseService } from "../_billing.js";
import { clientIp, keyedHash, rateLimitedEverywhere } from "../_rateLimit.js";
import { welcomeOnce } from "../_welcome.js";

type RequestLike = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

/** Supabase reads the destination of its email links from the query string,
 *  not the body; the body copy is kept for older auth servers. */
function withRedirect(path: string, redirect: string | undefined): string {
  return redirect ? `${path}?redirect_to=${encodeURIComponent(redirect)}` : path;
}

/** The one-time hash from a confirmation email. Supabase issues 56 hex
 *  characters, optionally prefixed for PKCE; anything else never reaches it. */
export function confirmationHash(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value) ? value : null;
}

/**
 * Finishes email confirmation from the link in the confirmation email.
 *
 * The email links to the Redaxa page with the one-time hash in the fragment,
 * and the page sends it here only after the reader selects Confirm. A link
 * that confirmed on a plain GET was spent by mail security scanners (Outlook
 * Safe Links and the like) before the person ever clicked it, who then saw
 * "invalid or expired". Confirming never signs anyone in: a valid link does
 * not prove this browser started the signup, so the reader signs in after.
 */
async function confirm(request: RequestLike, response: ResponseLike, hash: string): Promise<void> {
  if (await rateLimitedEverywhere(supabaseService, `confirm:ip:${clientIp(request.headers)}`, 10, 15 * 60_000)) {
    response.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    return;
  }
  const url = required("SUPABASE_URL").replace(/\/$/, "");
  const upstream = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: required("SUPABASE_PUBLISHABLE_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ type: "email", token_hash: hash }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await upstream.json().catch(() => ({})) as { access_token?: string; user?: { id?: string; email?: string; email_confirmed_at?: string; created_at?: string; user_metadata?: Record<string, unknown> } };
  if (!upstream.ok || !payload.user?.email_confirmed_at || !payload.user.email) {
    response.status(400).json({ error: "This confirmation link has expired or was already used. If you confirmed already, sign in; otherwise request a new email from Create account." });
    return;
  }
  const user = payload.user;
  if (user.id) await welcomeOnce({ id: user.id, email: user.email!, emailConfirmedAt: user.email_confirmed_at, createdAt: user.created_at, metadata: user.user_metadata });
  // The verified session is not handed to the browser; end it upstream so it does not linger.
  if (payload.access_token) {
    await fetch(`${url}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: required("SUPABASE_PUBLISHABLE_KEY"), Authorization: `Bearer ${payload.access_token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  }
  response.status(200).json({ ok: true, email: user.email });
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
  response.setHeader("Cache-Control", "no-store");
  try {
    const body = (request.body ?? {}) as { email?: unknown; password?: unknown; emailRedirectTo?: unknown; firstName?: unknown; lastName?: unknown; dateOfBirth?: unknown; resend?: unknown; confirm?: unknown };

    // Folded into this endpoint rather than a new file: Vercel's Hobby plan
    // caps a deployment at 12 serverless functions and this project is there.
    if (body.confirm !== undefined) {
      const hash = confirmationHash(body.confirm);
      if (!hash) { response.status(400).json({ error: "This confirmation link is incomplete. Open it again from the email, or request a new one." }); return; }
      await confirm(request, response, hash);
      return;
    }

    const email = typeof body.email === "string" ? body.email.trim() : "";
    // Only links back to Redaxa itself; see authRedirectUrl.
    const redirect = authRedirectUrl(body.emailRedirectTo);

    // Resend: same flow as a fresh signup, but only needs an email -- used
    // when the original confirmation link expired or never arrived.
    if (body.resend === true) {
      if (!email) { response.status(400).json({ error: "Enter your email address." }); return; }
      const ip = clientIp(request.headers);
      if (await rateLimitedEverywhere(supabaseService, `resend:ip:${ip}`, 5, 15 * 60_000) || await rateLimitedEverywhere(supabaseService, `resend:email:${keyedHash(email.toLowerCase())}`, 3, 15 * 60_000)) {
        response.status(200).json({ ok: true });
        return;
      }
      const url = required("SUPABASE_URL").replace(/\/$/, "");
      const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
      await fetch(withRedirect(`${url}/auth/v1/resend`, redirect), {
        method: "POST",
        headers: { apikey: publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "signup", email,
          options: redirect ? { email_redirect_to: redirect } : undefined
        })
      }).catch(() => undefined);
      // Always report success, same reasoning as recover.ts: this endpoint
      // must not be usable to enumerate which emails have an account.
      response.status(200).json({ ok: true });
      return;
    }

    const password = typeof body.password === "string" ? body.password : "";
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    if (!email || password.length < 12) { response.status(400).json({ error: "Enter a valid email and a password of at least 12 characters." }); return; }
    const ip = clientIp(request.headers);
    if (await rateLimitedEverywhere(supabaseService, `signup:ip:${ip}`, 10, 15 * 60_000)) {
      response.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
      return;
    }
    const url = required("SUPABASE_URL").replace(/\/$/, "");
    const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
    const upstream = await fetch(withRedirect(`${url}/auth/v1/signup`, redirect), {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        data: firstName ? { first_name: firstName.slice(0, 100) } : {},
        options: redirect ? { email_redirect_to: redirect } : undefined
      })
    });
    const payload = await upstream.json().catch(() => ({})) as { msg?: string; error_description?: string; error_code?: string; code?: string };
    if (!upstream.ok) {
      const code = payload.error_code ?? payload.code;
      const message = upstream.status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit"
        ? "Too many sign-up emails right now. Please wait a few minutes and try again."
        : code === "weak_password" ? (payload.msg ?? "Choose a stronger password.")
        : code === "email_address_invalid" || code === "validation_failed" ? "Enter a valid email address."
        : payload.msg ?? payload.error_description ?? "We could not create that account.";
      response.status(upstream.status === 429 ? 429 : upstream.status >= 500 ? 503 : 400).json({ error: message });
      return;
    }
    response.status(200).json({ ok: true });
  } catch {
    response.status(500).json({ error: "Account setup is not available right now." });
  }
}
