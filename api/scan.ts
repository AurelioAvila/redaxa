import { corsHeaders, effectiveEntitlement, requireUser } from "./_billing.js";
import { clientIp, rateLimited } from "./_rateLimit.js";
import { inspectPrompt, type ScanOptions } from "../scanner.js";

type RequestLike = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

const maxPromptLength = 20_000;

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
  try {
    const user = await requireUser(request, response);
    const entitlement = await effectiveEntitlement(user.id);
    if (!entitlement.active) { response.status(402).json({ error: "TRIAL_REQUIRED" }); return; }
    if (rateLimited(`scan:user:${user.id}`, 120, 60_000) || rateLimited(`scan:ip:${clientIp(request.headers)}`, 240, 60_000)) {
      response.status(429).json({ error: "Too many checks. Please slow down." });
      return;
    }
    const body = (request.body ?? {}) as { text?: unknown; options?: Partial<ScanOptions> };
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) { response.status(400).json({ error: "Nothing to scan." }); return; }
    if (text.length > maxPromptLength) { response.status(400).json({ error: "Prompt is too long for a check." }); return; }
    const options: ScanOptions = {
      includePersonalData: body.options?.includePersonalData !== false,
      includeCredentials: body.options?.includeCredentials !== false,
      includeFinancialData: body.options?.includeFinancialData !== false,
      customTerms: Array.isArray(body.options?.customTerms) ? body.options.customTerms.filter((term): term is string => typeof term === "string").slice(0, 30) : undefined
    };
    // Deliberately not logged, persisted, or forwarded anywhere: this request body is used
    // only to compute the response below, then discarded when the function returns.
    const result = inspectPrompt(text, options);
    response.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCAN_ERROR";
    response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not run that check." });
  }
}
