import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, corsHeaders, parseCookies, refreshSession } from "../_billing.js";

type RequestLike = { method?: string; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function bearerToken(headers: Record<string, string | string[] | undefined> | undefined): string | undefined {
  const raw = headers?.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : undefined;
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
  const cookies = parseCookies(request.headers?.cookie);
  let accessToken: string | undefined = bearerToken(request.headers) ?? cookies[ACCESS_COOKIE];
  // The short-lived access cookie may already be gone while the 30-day
  // refresh cookie is not: trade it for a session so that one ends upstream
  // too, instead of only being forgotten by this browser.
  if (!accessToken && cookies[REFRESH_COOKIE]) {
    accessToken = (await refreshSession(cookies[REFRESH_COOKIE]).catch(() => null))?.access_token;
  }
  if (accessToken) {
    try {
      const url = required("SUPABASE_URL").replace(/\/$/, "");
      // Local scope: signing out of one surface (extension, desktop, web)
      // must not end the sessions of the others. Supabase defaults to global.
      await fetch(`${url}/auth/v1/logout?scope=local`, {
        method: "POST",
        headers: { apikey: required("SUPABASE_PUBLISHABLE_KEY"), Authorization: `Bearer ${accessToken}` }
      });
    } catch { /* Session state is cleared client-side regardless of upstream revocation success. */ }
  }
  clearSessionCookies(response);
  response.status(200).json({ ok: true });
}
