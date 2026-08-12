import { corsHeaders, setSessionCookies, supabaseAuthUser } from "../_billing.js";

type RequestLike = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

// Supabase's email-confirmation and password-reset links redirect back with the
// session tokens in the URL fragment (#access_token=...), which never reaches
// the server on its own -- the client reads them and posts them here so the
// web dashboard can turn them into the same httpOnly cookies a normal sign-in
// sets. The desktop app never hits this: its confirmation links open in the
// system browser, not the app window.
export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
  try {
    const body = (request.body ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    if (!accessToken || !refreshToken) { response.status(400).json({ error: "Missing session tokens." }); return; }
    const user = await supabaseAuthUser(accessToken);
    if (!user) { response.status(401).json({ error: "UNAUTHORIZED" }); return; }
    setSessionCookies(response, accessToken, refreshToken, typeof body.expires_in === "number" ? body.expires_in : 3600);
    response.status(200).json({ email: user.email });
  } catch {
    response.status(500).json({ error: "We could not complete sign-in." });
  }
}
