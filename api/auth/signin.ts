import { corsHeaders, setSessionCookies } from "../_billing.js";
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
    const body = (request.body ?? {}) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) { response.status(400).json({ error: "Enter your email and password." }); return; }
    const ip = clientIp(request.headers);
    if (rateLimited(`signin:ip:${ip}`, 20, 5 * 60_000) || rateLimited(`signin:email:${email.toLowerCase()}`, 8, 5 * 60_000)) {
      response.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
      return;
    }
    const url = required("SUPABASE_URL").replace(/\/$/, "");
    const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
    const upstream = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const payload = await upstream.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; user?: { email?: string }; msg?: string; error_description?: string };
    if (!upstream.ok || !payload.access_token || !payload.refresh_token) {
      response.status(upstream.status || 401).json({ error: payload.msg ?? payload.error_description ?? "Incorrect email or password." });
      return;
    }
    setSessionCookies(response, payload.access_token, payload.refresh_token, payload.expires_in ?? 3600);
    // Cookies drive the web dashboard; the desktop app has no cookie jar of its
    // own, so it reads the tokens from the body instead and holds them itself.
    response.status(200).json({
      email: payload.user?.email ?? email,
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_in: payload.expires_in ?? 3600
    });
  } catch {
    response.status(500).json({ error: "Sign-in is not available right now." });
  }
}
