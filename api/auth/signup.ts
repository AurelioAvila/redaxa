import { corsHeaders } from "../_billing.js";
import { clientIp, rateLimited } from "../_rateLimit.js";

type RequestLike = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
  try {
    const body = (request.body ?? {}) as { email?: unknown; password?: unknown; emailRedirectTo?: unknown; firstName?: unknown; lastName?: unknown; dateOfBirth?: unknown; resend?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";

    // Resend: same flow as a fresh signup, but only needs an email -- used
    // when the original confirmation link expired or never arrived. Folded
    // into this endpoint rather than a new file: Vercel's Hobby plan caps a
    // deployment at 12 serverless functions and this project is already there.
    if (body.resend === true) {
      if (!email) { response.status(400).json({ error: "Enter your email address." }); return; }
      const ip = clientIp(request.headers);
      if (rateLimited(`resend:ip:${ip}`, 5, 15 * 60_000) || rateLimited(`resend:email:${email.toLowerCase()}`, 3, 15 * 60_000)) {
        response.status(200).json({ ok: true });
        return;
      }
      const url = required("SUPABASE_URL").replace(/\/$/, "");
      const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
      await fetch(`${url}/auth/v1/resend`, {
        method: "POST",
        headers: { apikey: publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "signup", email,
          options: typeof body.emailRedirectTo === "string" ? { email_redirect_to: body.emailRedirectTo } : undefined
        })
      }).catch(() => undefined);
      // Always report success, same reasoning as recover.ts: this endpoint
      // must not be usable to enumerate which emails have an account.
      response.status(200).json({ ok: true });
      return;
    }

    const password = typeof body.password === "string" ? body.password : "";
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    const dateOfBirth = typeof body.dateOfBirth === "string" ? body.dateOfBirth : "";
    if (!email || password.length < 12) { response.status(400).json({ error: "Enter a valid email and a password of at least 12 characters." }); return; }
    if (!firstName) { response.status(400).json({ error: "First name is required." }); return; }
    if (!lastName) { response.status(400).json({ error: "Last name is required." }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) { response.status(400).json({ error: "Date of birth is required." }); return; }
    const ip = clientIp(request.headers);
    if (rateLimited(`signup:ip:${ip}`, 10, 15 * 60_000)) {
      response.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
      return;
    }
    const url = required("SUPABASE_URL").replace(/\/$/, "");
    const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
    const upstream = await fetch(`${url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        data: { first_name: firstName, last_name: lastName, date_of_birth: dateOfBirth },
        options: typeof body.emailRedirectTo === "string" ? { email_redirect_to: body.emailRedirectTo } : undefined
      })
    });
    const payload = await upstream.json().catch(() => ({})) as { msg?: string; error_description?: string };
    if (!upstream.ok) { response.status(upstream.status).json({ error: payload.msg ?? payload.error_description ?? "We could not create that account." }); return; }
    response.status(200).json({ ok: true });
  } catch {
    response.status(500).json({ error: "Account setup is not available right now." });
  }
}
