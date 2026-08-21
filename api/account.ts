import { accountFor, corsHeaders, createApiKey, effectiveEntitlement, listApiKeys, requireUser, revokeApiKey, supabaseService } from "./_billing.js";
import { clientIp, rateLimited } from "./_rateLimit.js";

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
      status: account?.subscription_status ?? null,
      currentPeriodEnd: account?.current_period_end ?? null,
      plan: account?.plan ?? null,
      teamRole: entitlement.role,
      teamOwnerEmail: entitlement.ownerEmail,
      settings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ACCOUNT_ERROR";
    if (message !== "UNAUTHORIZED") console.error("account load error:", error);
    response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not load your account." });
  }
}
