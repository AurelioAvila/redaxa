type RequestLike = { method?: string; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(value: unknown): void;
  end(): void;
};

export default function handler(request: RequestLike, response: ResponseLike): void {
  const rawOrigin = request.headers?.origin;
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  const appOrigin = process.env.APP_URL?.replace(/\/$/, "") ?? "https://promptshield-beta.vercel.app";
  const allowedOrigins = new Set([appOrigin, "tauri://localhost", "https://tauri.localhost", "http://tauri.localhost"]);
  const extensionOrigin = origin?.startsWith("chrome-extension://") || origin?.startsWith("moz-extension://");
  response.setHeader("Access-Control-Allow-Origin", origin && (allowedOrigins.has(origin) || extensionOrigin) ? origin : appOrigin);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Refresh-Token");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Vary", "Origin");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).end();
    return;
  }

  // Only a boolean is exposed: the browser talks to Supabase exclusively through the
  // /api/auth/* proxy endpoints now, so it has no need for the project URL or key.
  const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ configured });
}
