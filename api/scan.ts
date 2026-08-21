import { corsHeaders, effectiveEntitlement, organizationMembershipFor, protectedTermsFor, requireUser, supabaseService } from "./_billing.js";
import { clientIp, rateLimited } from "./_rateLimit.js";
import { inspectPrompt, type ScanOptions } from "../scanner.js";
import { defaultPersonalPolicy, evaluatePolicy } from "../policy.js";

type RequestLike = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

const maxPromptLength = 20_000;

// The surface the prompt came from, self-reported by the client and used ONLY
// as audit metadata — it grants nothing. Values outside the allowlist are
// stored as "unknown" rather than trusted.
const knownApplications = new Set(["web", "extension", "desktop", "chatgpt", "claude", "gemini", "copilot", "perplexity", "api"]);

/**
 * Records a metadata-only audit event for a completed scan. Deliberately
 * fire-and-forget and failure-tolerant: an audit hiccup (missing table,
 * transient DB error) must never fail or slow the scan itself — and by
 * design there is nothing sensitive in the row to lose: kinds, counts,
 * decision, surface. Never the text, never a finding value.
 */
async function recordScanEvent(userId: string, organizationId: string | null, application: string, kinds: string[], categories: string[], findingCount: number, action: string): Promise<void> {
  try {
    await supabaseService("/rest/v1/scan_events", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        organization_id: organizationId,
        application,
        finding_kinds: [...new Set(kinds)],
        finding_categories: [...new Set(categories)],
        finding_count: findingCount,
        action
      })
    });
  } catch {
    // Audit is best-effort at this stage; the scan result already reached the user.
  }
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }

  // GET = the caller's own recent scan activity (metadata only). Folded into
  // this function because the Vercel Hobby plan caps deployments at 12
  // serverless functions and this project sits exactly at the cap.
  if (request.method === "GET") {
    try {
      const user = await requireUser(request, response);
      const eventsResponse = await supabaseService(`/rest/v1/scan_events?user_id=eq.${encodeURIComponent(user.id)}&select=created_at,application,finding_kinds,finding_categories,finding_count,action&order=created_at.desc&limit=50`, { method: "GET" });
      if (!eventsResponse.ok) { response.status(200).json({ events: [] }); return; }
      response.status(200).json({ events: await eventsResponse.json() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not load your activity." });
    }
    return;
  }

  if (request.method !== "POST") { response.setHeader("Allow", "GET, POST"); response.status(405).end(); return; }
  try {
    const user = await requireUser(request, response);
    const entitlement = await effectiveEntitlement(user.id);
    if (!entitlement.active) { response.status(402).json({ error: "TRIAL_REQUIRED" }); return; }
    if (rateLimited(`scan:user:${user.id}`, 120, 60_000) || rateLimited(`scan:ip:${clientIp(request.headers)}`, 240, 60_000)) {
      response.status(429).json({ error: "Too many checks. Please slow down." });
      return;
    }
    const body = (request.body ?? {}) as { text?: unknown; application?: unknown; options?: Partial<ScanOptions> };
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) { response.status(400).json({ error: "Nothing to scan." }); return; }
    if (text.length > maxPromptLength) { response.status(400).json({ error: "Prompt is too long for a check." }); return; }
    const options: ScanOptions = {
      includePersonalData: body.options?.includePersonalData !== false,
      includeCredentials: body.options?.includeCredentials !== false,
      includeFinancialData: body.options?.includeFinancialData !== false,
      customTerms: Array.isArray(body.options?.customTerms) ? body.options.customTerms.filter((term): term is string => typeof term === "string").slice(0, 30) : undefined
    };
    // Organization governance: a member's scans are also checked against the
    // organization's shared protected terms. Best-effort — if the lookup
    // fails, the scan proceeds with the caller's own options rather than
    // failing (detection availability beats governance completeness for now).
    let organizationId: string | null = null;
    try {
      const membership = await organizationMembershipFor(user.id);
      if (membership) {
        organizationId = membership.organization_id;
        const orgTerms = (await protectedTermsFor(membership.organization_id)).map((row) => row.term);
        if (orgTerms.length > 0) {
          options.customTerms = [...new Set([...(options.customTerms ?? []), ...orgTerms])].slice(0, 60);
        }
      }
    } catch {
      // Fall through with personal options only.
    }

    // Deliberately not logged, persisted, or forwarded anywhere: this request body is used
    // only to compute the response below, then discarded when the function returns.
    const result = inspectPrompt(text, options);

    // Policy evaluation: same findings, one explainable decision. Today this
    // is the default personal policy for everyone (it mirrors the product's
    // existing behavior: user decides, redaction offered); organization
    // policies will slot in here without the response shape changing.
    const decision = evaluatePolicy(result.findings, defaultPersonalPolicy);

    const application = typeof body.application === "string" && knownApplications.has(body.application) ? body.application : "unknown";
    void recordScanEvent(
      user.id,
      organizationId,
      application,
      result.findings.map((finding) => finding.kind),
      result.findings.map((finding) => finding.category),
      result.findings.length,
      decision.action
    );

    response.status(200).json({ ...result, decision });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCAN_ERROR";
    response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not run that check." });
  }
}
