import { clearSessionCookies, parseCookies, ACCESS_COOKIE } from "../_billing.js";

type RequestLike = { method?: string; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
  const accessToken = parseCookies(request.headers?.cookie)[ACCESS_COOKIE];
  if (accessToken) {
    try {
      const url = required("SUPABASE_URL").replace(/\/$/, "");
      await fetch(`${url}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: required("SUPABASE_PUBLISHABLE_KEY"), Authorization: `Bearer ${accessToken}` }
      });
    } catch { /* Cookie is cleared below regardless of upstream revocation success. */ }
  }
  clearSessionCookies(response);
  response.status(200).json({ ok: true });
}
