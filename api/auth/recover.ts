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
    await fetch(`${url}/auth/v1/recover`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirect_to: typeof body.redirect_to === "string" ? body.redirect_to : undefined })
    });
    // Always report success so this endpoint cannot be used to enumerate registered emails.
    response.status(200).json({ ok: true });
  } catch {
    response.status(200).json({ ok: true });
  }
}
