import { ACCESS_COOKIE, REFRESH_COOKIE, REMEMBER_COOKIE, clearSessionCookies, corsHeaders, parseCookies, refreshSession, setSessionCookies, supabaseAuthUser } from "../_billing.js";

type RequestLike = { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

function bearerToken(headers: Record<string, string | string[] | undefined> | undefined): string | undefined {
  const raw = headers?.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : undefined;
}

function header(headers: Record<string, string | string[] | undefined> | undefined, name: string): string | undefined {
  const raw = headers?.[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

// Folded in from the old standalone /api/auth-config function (see
// vercel.json's rewrite for that path to this file): the Hobby plan caps a
// deployment at 12 Serverless Functions, and a 30-line GET-only config probe
// didn't earn its own slot next to this one. `corsHeaders` is the exact same
// origin allowlist auth-config used inline, so nothing about who is allowed
// to call it changed - only where the code lives.
function isAuthConfigRequest(request: RequestLike): boolean {
  if (!request.url) return false;
  const pathname = request.url.split("?")[0];
  return pathname === "/api/auth-config";
}

function handleAuthConfig(request: RequestLike, response: ResponseLike): void {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") { response.setHeader("Allow", "GET"); response.status(405).end(); return; }
  // Only a boolean is exposed: the browser talks to Supabase exclusively
  // through the /api/auth/* proxy endpoints, so it has no need for the
  // project URL or key.
  const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ configured });
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  if (isAuthConfigRequest(request)) { handleAuthConfig(request, response); return; }

  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") { response.setHeader("Allow", "GET"); response.status(405).end(); return; }
  response.setHeader("Cache-Control", "no-store");

  // Desktop path: no cookies, the app sends its stored access token as a Bearer
  // header and (if that token is stale) its refresh token in a custom header so
  // this endpoint can mint a fresh pair for it to store, mirroring the cookie
  // refresh flow below.
  const bearerAccess = bearerToken(request.headers);
  if (bearerAccess) {
    const user = await supabaseAuthUser(bearerAccess);
    if (user) { response.status(200).json({ email: user.email }); return; }
    const bearerRefresh = header(request.headers, "x-refresh-token");
    if (bearerRefresh) {
      const refreshed = await refreshSession(bearerRefresh);
      if (refreshed) {
        const refreshedUser = await supabaseAuthUser(refreshed.access_token);
        if (refreshedUser) {
          response.status(200).json({
            email: refreshedUser.email,
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token,
            expires_in: refreshed.expires_in
          });
          return;
        }
      }
    }
    response.status(200).json({ email: null });
    return;
  }

  const cookies = parseCookies(request.headers?.cookie);
  const accessToken = cookies[ACCESS_COOKIE];
  if (accessToken) {
    const user = await supabaseAuthUser(accessToken);
    if (user) { response.status(200).json({ email: user.email }); return; }
  }
  const refreshToken = cookies[REFRESH_COOKIE];
  if (refreshToken) {
    const refreshed = await refreshSession(refreshToken);
    if (refreshed) {
      const user = await supabaseAuthUser(refreshed.access_token);
      if (user) {
        setSessionCookies(response, refreshed.access_token, refreshed.refresh_token, refreshed.expires_in, cookies[REMEMBER_COOKIE] === "1");
        response.status(200).json({ email: user.email });
        return;
      }
    }
    clearSessionCookies(response);
  }
  response.status(200).json({ email: null });
}
