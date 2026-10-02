import { corsHeaders } from "../_billing.js";

type RequestLike = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

// Legacy fragment adoption is retired: a valid token does not prove that this
// browser initiated sign-in. Confirmation links finish verification upstream;
// users sign in here with their own credentials. Recovery has its explicit form.
export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
  response.setHeader("Cache-Control", "no-store");
  response.status(410).json({ error: "This sign-in link cannot create a session. Sign in with your email and password." });
}
