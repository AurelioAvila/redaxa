import { clientIp, rateLimited } from "../_rateLimit.js";

type RequestLike = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
  try {
    const body = (request.body ?? {}) as { email?: unknown; password?: unknown; emailRedirectTo?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || password.length < 12) { response.status(400).json({ error: "Enter a valid email and a password of at least 12 characters." }); return; }
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
      body: JSON.stringify({ email, password, options: typeof body.emailRedirectTo === "string" ? { email_redirect_to: body.emailRedirectTo } : undefined })
    });
    const payload = await upstream.json().catch(() => ({})) as { msg?: string; error_description?: string };
    if (!upstream.ok) { response.status(upstream.status).json({ error: payload.msg ?? payload.error_description ?? "We could not create that account." }); return; }
    response.status(200).json({ ok: true });
  } catch {
    response.status(500).json({ error: "Account setup is not available right now." });
  }
}
