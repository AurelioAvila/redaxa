import { corsHeaders, effectiveEntitlement, organizationMembershipFor, orgScanContextFor, protectedTermsFor, requireUser, supabaseService, supabaseUserById } from "./_billing.js";
import { clientIp, rateLimited, rateLimitedShared } from "./_rateLimit.js";
import { auditBoundary, auditCsv, defaultAuditRows, maxAuditRows, type AuditEvent } from "./_audit.js";
import { inspectPrompt, type ScanOptions } from "../scanner.js";
import { buildOrganizationPolicy, defaultPersonalPolicy, evaluatePolicy, type PolicyRule } from "../policy.js";

type RequestLike = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; send?(body: string): void; end(body?: string): void };

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

function queryValue(request: RequestLike, name: string): string | undefined {
  const query = (request as { query?: Record<string, string | string[] | undefined> }).query;
  const raw = query?.[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }

  // GET = recent scan activity (metadata only). Folded into this function
  // because the Vercel Hobby plan caps deployments at 12 serverless functions
  // and this project sits exactly at the cap. Default scope: the caller's own
  // events. ?scope=org: the whole organization's events — owners and admins
  // only, the visibility the Business plan exists for.
  if (request.method === "GET") {
    try {
      const user = await requireUser(request, response);
      const scope = queryValue(request, "scope");
      const format = queryValue(request, "format");
      const from = auditBoundary(queryValue(request, "from"), false);
      const to = auditBoundary(queryValue(request, "to"), true);
      if (queryValue(request, "from") && !from) { response.status(400).json({ error: "The start date is not a date." }); return; }
      if (queryValue(request, "to") && !to) { response.status(400).json({ error: "The end date is not a date." }); return; }
      if (from && to && from > to) { response.status(400).json({ error: "The start date is after the end date." }); return; }

      let filter = `user_id=eq.${encodeURIComponent(user.id)}`;
      if (scope === "org") {
        const membership = await organizationMembershipFor(user.id);
        if (!membership || (membership.role !== "owner" && membership.role !== "admin")) { response.status(403).json({ error: "Only organization owners and admins can view team activity." }); return; }
        filter = `organization_id=eq.${encodeURIComponent(membership.organization_id)}`;
      }
      // Both boundaries are ISO strings this function produced, never the
      // caller's own text — see auditBoundary.
      if (from) filter += `&created_at=gte.${encodeURIComponent(from)}`;
      if (to) filter += `&created_at=lte.${encodeURIComponent(to)}`;

      // An export reads the whole range; the dashboard reads a window of it.
      const limit = format === "csv" ? maxAuditRows : defaultAuditRows;

      // `count=exact` is what stops the dashboard from lying. The metrics used
      // to be computed over whatever page had been fetched and then labelled
      // "Team checks" — so an organization with five thousand checks read as
      // fifty. The count is of the range, not of the page.
      const eventsResponse = await supabaseService(
        `/rest/v1/scan_events?${filter}&select=created_at,application,finding_kinds,finding_categories,finding_count,action,user_id&order=created_at.desc&limit=${limit}`,
        { method: "GET", headers: { Prefer: "count=exact" } }
      );
      if (!eventsResponse.ok) { response.status(200).json({ events: [], total: 0, truncated: false }); return; }
      const events = await eventsResponse.json() as AuditEvent[];

      // Content-Range comes back as "0-49/1234"; the tail is the real total.
      const total = Number.parseInt((eventsResponse.headers.get("content-range") ?? "").split("/")[1] ?? "", 10);
      const rangeTotal = Number.isFinite(total) ? total : events.length;
      const truncated = rangeTotal > events.length;

      // Resolve member emails so an org view reads as people rather than
      // UUIDs. An export gets a far higher cap than a screen does: a CSV with
      // blank member columns past the tenth person is not an audit record.
      let emailById = new Map<string, string | null>();
      if (scope === "org") {
        const ids = [...new Set(events.map((event) => event.user_id))].slice(0, format === "csv" ? 200 : 10);
        emailById = new Map(await Promise.all(ids.map(async (id) => [id, (await supabaseUserById(id))?.email ?? null] as [string, string | null])));
      }

      if (format === "csv") {
        const stamp = `${from ? from.slice(0, 10) : "start"}_${to ? to.slice(0, 10) : new Date().toISOString().slice(0, 10)}`;
        const filename = `redaxa-audit-${scope === "org" ? "organization" : "account"}-${stamp}.csv`;
        const csv = auditCsv(events, emailById, scope === "org" ? "org" : "account", from, to, truncated);
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        response.status(200);
        if (response.send) response.send(csv); else response.end(csv);
        return;
      }

      response.status(200).json({
        events: events.map(({ user_id, ...event }) => ({ ...event, member: scope === "org" ? emailById.get(user_id) ?? null : undefined })),
        // The dashboard needs both numbers to describe itself honestly: how
        // many events exist in the range, and how many of them it is holding.
        total: rangeTotal,
        truncated
      });
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
    if (
      rateLimited(`scan:user:${user.id}`, 120, 60_000) ||
      rateLimited(`scan:ip:${clientIp(request.headers)}`, 240, 60_000) ||
      await rateLimitedShared(supabaseService, `scan:user:${user.id}`, 120, 60)
    ) {
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
    let policyRules: PolicyRule[] = defaultPersonalPolicy;
    try {
      // One embedded query for membership + shared terms + policies; the
      // two-call fallback covers the window where org_policies does not
      // exist yet (embedding fails as a whole when one relation is missing).
      let context = await orgScanContextFor(user.id);
      if (!context) {
        const membership = await organizationMembershipFor(user.id);
        if (membership) context = { organizationId: membership.organization_id, terms: (await protectedTermsFor(membership.organization_id)).map((row) => row.term), policies: [] };
      }
      if (context) {
        organizationId = context.organizationId;
        if (context.terms.length > 0) {
          options.customTerms = [...new Set([...(options.customTerms ?? []), ...context.terms])].slice(0, 60);
        }
        if (context.policies.length > 0) {
          const overrides: Parameters<typeof buildOrganizationPolicy>[0] = {};
          for (const row of context.policies) {
            overrides[row.category] = { action: row.action, minSeverity: row.min_severity ?? undefined };
          }
          policyRules = buildOrganizationPolicy(overrides);
        }
      }
    } catch {
      // Fall through with personal options and the default policy.
    }

    // Deliberately not logged, persisted, or forwarded anywhere: this request body is used
    // only to compute the response below, then discarded when the function returns.
    const result = inspectPrompt(text, options);

    // Policy evaluation: same findings, one explainable decision — the
    // organization's rules when it has set any, the default personal policy
    // otherwise.
    const decision = evaluatePolicy(result.findings, policyRules);

    const application = typeof body.application === "string" && knownApplications.has(body.application) ? body.application : "unknown";
    // Awaited, not fire-and-forget: a serverless function is frozen the moment
    // the response is sent, so an un-awaited insert is silently killed mid-
    // flight most of the time (observed in production: events went missing).
    // recordScanEvent still swallows its own failures, so a DB hiccup delays
    // the response by at most one timeout instead of failing the scan.
    await recordScanEvent(
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
