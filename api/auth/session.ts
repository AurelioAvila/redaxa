import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, parseCookies, refreshSession, setSessionCookies, supabaseAuthUser } from "../_billing.js";

type RequestLike = { method?: string; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  if (request.method !== "GET") { response.setHeader("Allow", "GET"); response.status(405).end(); return; }
  response.setHeader("Cache-Control", "no-store");
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
        setSessionCookies(response, refreshed.access_token, refreshed.refresh_token, refreshed.expires_in);
        response.status(200).json({ email: user.email });
        return;
      }
    }
    clearSessionCookies(response);
  }
  response.status(200).json({ email: null });
}
