import { accountFor, billingAppUrl, clearSessionCookies, corsHeaders, createApiKey, effectiveEntitlement, listApiKeys, requireSession, requireUser, revokeApiKey, supabaseService } from "./_billing.js";
import { clientIp, rateLimited, rateLimitedEverywhere } from "./_rateLimit.js";
import { billingView } from "./_trial.js";
import { deleteAccount } from "./_account-delete.js";

type RequestLike = { method?: string; body?: unknown; query?: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

// Only these keys sync across devices; theme/language are device preferences
// and deliberately stay local. Values are copied field-by-field rather than
// stored wholesale so a tampered client can't park arbitrary data in the row.
function sanitizeSettings(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["detectPersonal", "detectCredentials", "detectFinancial"] as const) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  if (raw.scanMode === "standard" || raw.scanMode === "strict") out.scanMode = raw.scanMode;
  if (Array.isArray(raw.customTerms)) {
    out.customTerms = [...new Set(raw.customTerms.filter((term): term is string => typeof term === "string" && term.trim().length >= 2).map((term) => term.trim().slice(0, 64)))].slice(0, 30);
  }
  return out;
}

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  response.setHeader("Cache-Control", "no-store");

  const action = Array.isArray(request.query?.action) ? request.query?.action[0] : request.query?.action;

  // Dedicated API key management, folded in here (12-function cap). GET
  // ?action=keys lists metadata; POST ?action=key-create returns the
  // plaintext key EXACTLY ONCE; POST ?action=key-revoke disables one.
  if (action === "keys" && request.method === "GET") {
    try {
      const user = await requireUser(request, response);
      const keys = await listApiKeys(user.id);
      response.status(200).json({ keys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.key_prefix, createdAt: k.created_at, lastUsedAt: k.last_used_at, revoked: k.revoked_at !== null })) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not load your API keys." });
    }
    return;
  }
  if ((action === "key-create" || action === "key-revoke") && request.method === "POST") {
    try {
      const user = await requireUser(request, response);
      if (rateLimited(`apikeys:user:${user.id}`, 20, 60 * 60_000)) {
        response.status(429).json({ error: "Too many key operations. Please wait." });
        return;
      }
      const body = (request.body ?? {}) as { name?: unknown; keyId?: unknown };
      if (action === "key-create") {
        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "API key";
        const created = await createApiKey(user.id, name);
        if (!created) { response.status(409).json({ error: "You can have up to 10 active API keys." }); return; }
        response.status(200).json({ key: created.key, id: created.meta.id, prefix: created.meta.key_prefix });
      } else {
        const keyId = typeof body.keyId === "string" ? body.keyId : "";
        if (!keyId) { response.status(400).json({ error: "Missing key id." }); return; }
        await revokeApiKey(user.id, keyId);
        response.status(200).json({ ok: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not complete that key operation." });
    }
    return;
  }

  // POST ?action=delete: the account deletes itself (api/_account-delete.ts).
  if (action === "delete") {
    if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
    const contentType = request.headers?.["content-type"];
    if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      response.status(415).json({ error: "Send a JSON request." }); return;
    }
    // Cross-site request forgery: a cookie session counts only from the site
    // itself, with the Origin every browser sends on a POST; a sibling
    // getcertsprint.com page is same-site and would carry the cookies. The
    // apps send their own Bearer token, which no other page can attach.
    const origin = request.headers?.origin;
    const authorization = request.headers?.authorization;
    const bearer = typeof authorization === "string" && authorization.startsWith("Bearer ");
    if (bearer ? origin !== undefined && origin !== cors["Access-Control-Allow-Origin"] : origin !== billingAppUrl(request)) {
      response.status(403).json({ error: "This request must come from Redaxa itself." }); return;
    }
    try {
      if (await rateLimitedEverywhere(supabaseService, `account-delete:ip:${clientIp(request.headers)}`, 10, 60 * 60_000)) {
        response.status(429).json({ error: "Too many attempts. Please wait an hour and try again." }); return;
      }
      // No API key: one leaked from a CI log must not be able to delete the account.
      const { user, accessToken } = await requireSession(request, response);
      if (!accessToken) throw new Error("UNAUTHORIZED");
      // Per account in memory, like the other account limits: the shared counters hold hashes only.
      if (rateLimited(`account-delete:user:${user.id}`, 5, 60 * 60_000)) {
        response.status(429).json({ error: "Too many attempts. Please wait an hour and try again." }); return;
      }
      const typed = (request.body as { email?: unknown } | undefined)?.email;
      if (typeof typed !== "string" || typed.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
        response.status(400).json({ error: "Type the email address of this account to confirm.", code: "confirm_email" }); return;
      }
      const result = await deleteAccount(user, accessToken);
      clearSessionCookies(response);
      response.status(200).json({ ok: true, signInKept: result.signInKept, subscriptionsEnded: result.subscriptionsEnded });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const [status, text] = message === "UNAUTHORIZED" ? [401, "UNAUTHORIZED"]
        : message === "FRAME_WITNESS_UNAVAILABLE" ? [503, "We could not finish the checks needed to delete your account, so nothing has changed. Please try again in a few minutes."]
        : message === "BILLING_ERROR" ? [502, "We could not finish ending your subscription, so the account was not deleted. Please try again in a few minutes."]
        : [500, "We could not finish deleting your account. Please try again: anything already removed stays removed."];
      if (status === 500) console.error("account deletion failed:", message.slice(0, 200));
      response.status(status).json({ error: text });
    }
    return;
  }

  // POST = save the caller's synced settings (upsert of one jsonb row).
  if (request.method === "POST") {
    try {
      const user = await requireUser(request, response);
      if (rateLimited(`settings:user:${user.id}`, 30, 60_000) || rateLimited(`settings:ip:${clientIp(request.headers)}`, 60, 60_000)) {
        response.status(429).json({ error: "Too many updates. Please slow down." });
        return;
      }
      const settings = sanitizeSettings((request.body as { settings?: unknown } | undefined)?.settings);
      if (!settings) { response.status(400).json({ error: "Nothing to save." }); return; }
      const saved = await supabaseService("/rest/v1/user_settings?on_conflict=user_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ user_id: user.id, settings, updated_at: new Date().toISOString() })
      });
      if (!saved.ok) { response.status(200).json({ ok: false }); return; }
      response.status(200).json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "ACCOUNT_ERROR";
      response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not save your settings." });
    }
    return;
  }

  if (request.method !== "GET") { response.setHeader("Allow", "GET, POST"); response.status(405).end(); return; }
  try {
    const user = await requireUser(request, response);
    const entitlement = await effectiveEntitlement(user.id);
    const account = entitlement.account ?? await accountFor(user.id);
    // Synced settings ride along on the account payload every surface already
    // fetches at startup — no extra endpoint, no extra round-trip.
    let settings: Record<string, unknown> | null = null;
    try {
      const settingsResponse = await supabaseService(`/rest/v1/user_settings?user_id=eq.${encodeURIComponent(user.id)}&select=settings`, { method: "GET" });
      if (settingsResponse.ok) settings = (await settingsResponse.json() as Array<{ settings?: Record<string, unknown> }>)[0]?.settings ?? null;
    } catch { /* settings are optional; the account payload must still load */ }
    response.status(200).json({
      email: user.email,
      active: entitlement.active,
      repositoryAccess: entitlement.active && (entitlement.role === 'member' || ['personal','pro','business'].includes(account?.plan ?? '')),
      status: account?.subscription_status ?? null,
      currentPeriodEnd: account?.current_period_end ?? null,
      plan: account?.plan ?? null,
      teamRole: entitlement.role,
      teamOwnerEmail: entitlement.ownerEmail,
      // The account's own subscription as the plan screens describe it:
      // trial, active, or blocked and why. Only added fields, so clients that
      // do not know them read the payload exactly as before.
      billing: await billingView(user, account),
      settings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ACCOUNT_ERROR";
    if (message !== "UNAUTHORIZED") console.error("account load error:", error);
    response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not load your account." });
  }
}
