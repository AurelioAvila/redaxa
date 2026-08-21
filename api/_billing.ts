import Stripe from "stripe";

type Json = Record<string, unknown>;

export type BillingUser = { id: string; email: string };
export type BillingAccount = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  has_used_trial: boolean;
  subscription_status: string | null;
  current_period_end: string | null;
  plan: string | null;
  seat_count: number;
};

export type TeamInvite = {
  id: string;
  owner_user_id: string;
  token: string;
  status: "pending" | "accepted" | "revoked";
  member_user_id: string | null;
  created_at: string;
  accepted_at: string | null;
};

// A subscription in one of these states is what unlocks the scanner: 'trialing'
// covers the 7-day trial, 'active' a paid subscription. 'past_due' is
// deliberately excluded -- a failed payment should stop new scans rather than
// keep granting access indefinitely.
export function hasActiveEntitlement(account: BillingAccount | null): boolean {
  return account?.subscription_status === "trialing" || account?.subscription_status === "active";
}

export const stripe = new Stripe(required("STRIPE_SECRET_KEY"), { typescript: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function supabaseUrl(): string { return required("SUPABASE_URL").replace(/\/$/, ""); }
function serviceKey(): string { return required("SUPABASE_SERVICE_ROLE_KEY"); }

// The browser never holds the Supabase access/refresh tokens directly. They are set as
// httpOnly cookies by the /api/auth/* endpoints so an XSS bug cannot exfiltrate a session.
export const ACCESS_COOKIE = "ps_at";
export const REFRESH_COOKIE = "ps_rt";
// Marker cookie recording whether the session should persist across
// browser restarts, given the same Max-Age treatment as the refresh
// cookie itself. Without this, a silent token refresh (which happens on
// almost every request once the short-lived access token expires) would
// have no way to know the original "Remember me" choice and would always
// re-issue a 30-day persistent cookie, silently overriding "don't remember".
export const REMEMBER_COOKIE = "ps_rem";

export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const value = Array.isArray(header) ? header.join("; ") : header;
  const out: Record<string, string> = {};
  if (!value) return out;
  for (const part of value.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { out[key] = part.slice(index + 1).trim(); }
  }
  return out;
}

function cookieAttributes(maxAgeSeconds: number | null): string {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL === "1" ? "; Secure" : "";
  const age = maxAgeSeconds === null ? "; Max-Age=0" : maxAgeSeconds > 0 ? `; Max-Age=${maxAgeSeconds}` : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}${age}`;
}

// remember=false issues session cookies (no Max-Age -- gone when the
// browser closes) instead of the normal 30-day persistent cookie, for
// "Remember me" left unchecked at sign-in. The access cookie is always
// short-lived either way since requireUser() transparently refreshes it.
export function setSessionCookies(response: { setHeader(name: string, value: string | string[]): void; getHeader?(name: string): unknown }, accessToken: string, refreshToken: string, expiresIn: number, remember = true): void {
  const refreshMaxAge = 60 * 60 * 24 * 30;
  response.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=${encodeURIComponent(accessToken)}; ${cookieAttributes(remember ? expiresIn : 0)}`,
    `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}; ${cookieAttributes(remember ? refreshMaxAge : 0)}`,
    `${REMEMBER_COOKIE}=1; ${cookieAttributes(remember ? refreshMaxAge : 0)}`
  ]);
}

export function clearSessionCookies(response: { setHeader(name: string, value: string | string[]): void }): void {
  response.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=; ${cookieAttributes(null)}`,
    `${REFRESH_COOKIE}=; ${cookieAttributes(null)}`,
    `${REMEMBER_COOKIE}=; ${cookieAttributes(null)}`
  ]);
}

export async function refreshSession(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number; user?: { email?: string } } | null> {
  const response = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: required("SUPABASE_PUBLISHABLE_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!response.ok) return null;
  return response.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number; user?: { email?: string } }>;
}

export async function supabaseAuthUser(accessToken: string): Promise<{ id: string; email: string } | null> {
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: required("SUPABASE_PUBLISHABLE_KEY"), Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  const body = await response.json() as { id?: string; email?: string };
  if (!body.id || !body.email) return null;
  return { id: body.id, email: body.email };
}

// Exported for other API modules (scan events audit): a service-role REST
// call. Named to make the privilege explicit at every call site.
export async function supabaseService(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${supabaseUrl()}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

// The desktop app has no domain of its own to hold a cookie, so it authenticates
// with a Supabase access token it stores itself and sends as `Authorization:
// Bearer`, matching how PC Tweaker's and Social Dashboard's desktop builds work.
// This is intentionally a *different* trust model from the web dashboard's
// httpOnly cookie (which stays immune to token theft via XSS): a Bearer token
// requires the caller to already possess it, so allowing it cross-origin here
// does not expose the cookie-based web session to anyone.
function bearerToken(headers: Record<string, string | string[] | undefined> | undefined): string | undefined {
  const raw = headers?.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : undefined;
}

// Only these origins may read cross-origin responses: the production web app and the
// Tauri desktop shell (which has no origin of its own to allowlist by hostname). Any
// other Origin still gets a response -- these are unauthenticated-safe endpoints or
// enforce their own auth -- but the browser will refuse to let a page on another origin
// read it, since ACAO won't match. Reflecting arbitrary origins was previously harmless
// (no Access-Control-Allow-Credentials, and session cookies are SameSite=Lax so they
// never ride along on cross-site fetches) but an explicit allowlist is cheap insurance
// against that assumption breaking later.
function allowedOrigins(): Set<string> {
  // Tauri v2 on Windows/Linux serves the app over the https scheme
  // (https://tauri.localhost), not http -- macOS/iOS use the tauri://
  // custom scheme instead. A CORS preflight (triggered whenever
  // desktopAccessToken() sends Authorization/X-Refresh-Token headers to
  // refresh an expired access token) silently fails if the origin isn't
  // an exact match, which read as "have to click Log in, then it just
  // works" -- the app looked logged out until something (focus, a click)
  // happened to hit a code path that didn't need the cross-origin fetch.
  return new Set([appUrl(), "tauri://localhost", "https://tauri.localhost", "http://tauri.localhost"]);
}

// The browser extension's background service worker runs at a
// chrome-extension://<id> origin, and the id differs between a locally
// loaded/unpacked build and the eventual Web Store listing, so it can't be
// pinned to one exact origin the way the desktop app's fixed schemes can.
// Allowing the whole chrome-extension:// (and moz-extension:// for a future
// Firefox port) scheme is still safe: every endpoint that returns anything
// sensitive requires a valid Bearer token, which only exists in a given
// extension's own isolated chrome.storage.local after its user explicitly
// signs in through it -- no other extension or page can obtain one just by
// being able to read a CORS response.
function isExtensionOrigin(origin: string): boolean {
  return origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");
}

export function corsHeaders(request: { headers?: Record<string, string | string[] | undefined> }): Record<string, string> {
  const rawOrigin = request.headers?.origin;
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  return {
    "Access-Control-Allow-Origin": origin && (allowedOrigins().has(origin) || isExtensionOrigin(origin)) ? origin : appUrl(),
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Refresh-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin"
  };
}

export async function requireUser(
  request: { headers?: Record<string, string | string[] | undefined> },
  response?: { setHeader(name: string, value: string | string[]): void }
): Promise<BillingUser> {
  const bearer = bearerToken(request.headers);
  if (bearer) {
    const user = await supabaseAuthUser(bearer);
    if (user) return user;
  }
  const cookies = parseCookies(request.headers?.cookie);
  const accessToken = cookies[ACCESS_COOKIE];
  if (accessToken) {
    const user = await supabaseAuthUser(accessToken);
    if (user) return user;
  }
  const refreshToken = cookies[REFRESH_COOKIE];
  if (refreshToken && response) {
    const refreshed = await refreshSession(refreshToken);
    if (refreshed) {
      const user = await supabaseAuthUser(refreshed.access_token);
      if (user) {
        setSessionCookies(response, refreshed.access_token, refreshed.refresh_token, refreshed.expires_in, cookies[REMEMBER_COOKIE] === "1");
        return user;
      }
    }
  }
  throw new Error("UNAUTHORIZED");
}

export async function reserveCheckout(userId: string): Promise<BillingAccount> {
  const response = await supabaseService("/rest/v1/rpc/reserve_billing_checkout", {
    method: "POST", body: JSON.stringify({ p_user_id: userId })
  });
  if (!response.ok) {
    const detail = await response.text();
    if (detail.includes("active subscription")) throw new Error("ACTIVE_SUBSCRIPTION");
    if (detail.includes("already being prepared")) throw new Error("CHECKOUT_IN_PROGRESS");
    console.error("reserveCheckout RPC failed:", response.status, detail);
    throw new Error("BILLING_STORAGE_ERROR");
  }
  return response.json() as Promise<BillingAccount>;
}

export async function releaseCheckout(userId: string): Promise<void> {
  await supabaseService(`/rest/v1/billing_accounts?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH", body: JSON.stringify({ checkout_lock_at: null })
  });
}

export async function saveCustomer(userId: string, customerId: string): Promise<void> {
  const response = await supabaseService(`/rest/v1/billing_accounts?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH", body: JSON.stringify({ stripe_customer_id: customerId })
  });
  if (!response.ok) {
    console.error("saveCustomer PATCH failed:", response.status, await response.text());
    throw new Error("BILLING_STORAGE_ERROR");
  }
}

export async function accountFor(userId: string): Promise<BillingAccount | null> {
  const response = await supabaseService(`/rest/v1/billing_accounts?user_id=eq.${encodeURIComponent(userId)}&select=stripe_customer_id,stripe_subscription_id,has_used_trial,subscription_status,current_period_end,plan,seat_count`, { method: "GET" });
  if (!response.ok) throw new Error("BILLING_STORAGE_ERROR");
  const rows = await response.json() as BillingAccount[];
  return rows[0] ?? null;
}

// A user is entitled to scan either because their own account has an active
// trial/subscription, or because they accepted an invite onto a business
// team whose owner still has an active seat for them. Membership does not
// grant access if the owner's subscription lapses.
export async function effectiveEntitlement(userId: string): Promise<{ active: boolean; role: "owner" | "member" | null; ownerEmail: string | null; account: BillingAccount | null }> {
  const account = await accountFor(userId);
  if (hasActiveEntitlement(account)) return { active: true, role: "owner", ownerEmail: null, account };
  const membership = await teamMembershipFor(userId);
  if (!membership) return { active: false, role: null, ownerEmail: null, account };
  const ownerAccount = await accountFor(membership.owner_user_id);
  if (!hasActiveEntitlement(ownerAccount) || ownerAccount?.plan !== "business") return { active: false, role: "member", ownerEmail: null, account };
  const ownerUser = await supabaseUserById(membership.owner_user_id);
  return { active: true, role: "member", ownerEmail: ownerUser?.email ?? null, account };
}

export async function supabaseUserById(userId: string): Promise<{ email?: string } | null> {
  const response = await supabaseService(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "GET" });
  if (!response.ok) return null;
  return response.json() as Promise<{ email?: string }>;
}

export async function teamMembershipFor(userId: string): Promise<TeamInvite | null> {
  const response = await supabaseService(`/rest/v1/team_invites?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.accepted&select=*`, { method: "GET" });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
  const rows = await response.json() as TeamInvite[];
  return rows[0] ?? null;
}

export async function teamInvitesFor(ownerUserId: string): Promise<TeamInvite[]> {
  const response = await supabaseService(`/rest/v1/team_invites?owner_user_id=eq.${encodeURIComponent(ownerUserId)}&status=in.(pending,accepted)&select=*&order=created_at.asc`, { method: "GET" });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
  return response.json() as Promise<TeamInvite[]>;
}

export async function createTeamInvite(ownerUserId: string): Promise<TeamInvite> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const response = await supabaseService("/rest/v1/team_invites", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ owner_user_id: ownerUserId, token })
  });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
  const rows = await response.json() as TeamInvite[];
  return rows[0];
}

export async function revokeTeamInvite(ownerUserId: string, inviteId: string): Promise<void> {
  const response = await supabaseService(`/rest/v1/team_invites?id=eq.${encodeURIComponent(inviteId)}&owner_user_id=eq.${encodeURIComponent(ownerUserId)}&status=eq.pending`, {
    method: "PATCH", body: JSON.stringify({ status: "revoked" })
  });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
}

export async function inviteByToken(token: string): Promise<TeamInvite | null> {
  const response = await supabaseService(`/rest/v1/team_invites?token=eq.${encodeURIComponent(token)}&select=*`, { method: "GET" });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
  const rows = await response.json() as TeamInvite[];
  return rows[0] ?? null;
}

// Atomic: the WHERE clause only matches a still-pending invite, so two
// concurrent accept attempts on the same token can't both succeed. Callers
// must reject owner_user_id === memberUserId themselves first -- this alone
// would let an owner "accept" their own invite since the WHERE clause has no
// opinion about who the member is.
export async function acceptTeamInvite(token: string, memberUserId: string): Promise<TeamInvite | null> {
  const response = await supabaseService(`/rest/v1/team_invites?token=eq.${encodeURIComponent(token)}&status=eq.pending`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ member_user_id: memberUserId, status: "accepted", accepted_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
  const rows = await response.json() as TeamInvite[];
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Organizations (M2). The organization is the governance layer: entitlement
// still comes from the owner's subscription, but membership, roles, shared
// protected terms and per-org audit hang off these tables.

export type OrganizationRole = "owner" | "admin" | "member";
export type Organization = { id: string; name: string; owner_user_id: string; created_at: string };
export type OrganizationMembership = { organization_id: string; user_id: string; role: OrganizationRole };
export type ProtectedTerm = { id: string; term: string; created_at: string };

export async function organizationMembershipFor(userId: string): Promise<OrganizationMembership | null> {
  const response = await supabaseService(`/rest/v1/organization_members?user_id=eq.${encodeURIComponent(userId)}&select=organization_id,user_id,role`, { method: "GET" });
  if (!response.ok) throw new Error("ORG_STORAGE_ERROR");
  const rows = await response.json() as OrganizationMembership[];
  return rows[0] ?? null;
}

export async function organizationById(orgId: string): Promise<Organization | null> {
  const response = await supabaseService(`/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}&select=*`, { method: "GET" });
  if (!response.ok) throw new Error("ORG_STORAGE_ERROR");
  const rows = await response.json() as Organization[];
  return rows[0] ?? null;
}

export async function organizationMembers(orgId: string): Promise<Array<{ user_id: string; role: OrganizationRole; joined_at: string }>> {
  const response = await supabaseService(`/rest/v1/organization_members?organization_id=eq.${encodeURIComponent(orgId)}&select=user_id,role,joined_at&order=joined_at.asc`, { method: "GET" });
  if (!response.ok) throw new Error("ORG_STORAGE_ERROR");
  return response.json() as Promise<Array<{ user_id: string; role: OrganizationRole; joined_at: string }>>;
}

/** Creates the org + owner membership for a business owner if missing.
 *  Idempotent: unique constraints make double-creation a no-op. */
export async function ensureOrganization(ownerUserId: string): Promise<Organization | null> {
  await supabaseService("/rest/v1/organizations", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ owner_user_id: ownerUserId })
  });
  const orgResponse = await supabaseService(`/rest/v1/organizations?owner_user_id=eq.${encodeURIComponent(ownerUserId)}&select=*`, { method: "GET" });
  if (!orgResponse.ok) throw new Error("ORG_STORAGE_ERROR");
  const orgs = await orgResponse.json() as Organization[];
  const org = orgs[0] ?? null;
  if (!org) return null;
  await supabaseService("/rest/v1/organization_members", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ organization_id: org.id, user_id: ownerUserId, role: "owner" })
  });
  return org;
}

export async function addOrganizationMember(orgId: string, userId: string, role: OrganizationRole): Promise<void> {
  await supabaseService("/rest/v1/organization_members", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ organization_id: orgId, user_id: userId, role })
  });
}

export async function removeOrganizationMember(orgId: string, userId: string): Promise<void> {
  await supabaseService(`/rest/v1/organization_members?organization_id=eq.${encodeURIComponent(orgId)}&user_id=eq.${encodeURIComponent(userId)}&role=neq.owner`, { method: "DELETE" });
}

export async function renameOrganization(orgId: string, name: string): Promise<void> {
  const response = await supabaseService(`/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}`, {
    method: "PATCH", body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error("ORG_STORAGE_ERROR");
}

export type OrgPolicyRow = { category: "personal" | "credentials" | "financial" | "custom"; action: "warn" | "redact" | "block" };

export async function orgPoliciesFor(orgId: string): Promise<OrgPolicyRow[]> {
  const response = await supabaseService(`/rest/v1/org_policies?organization_id=eq.${encodeURIComponent(orgId)}&select=category,action`, { method: "GET" });
  if (!response.ok) return [];
  return response.json() as Promise<OrgPolicyRow[]>;
}

export async function setOrgPolicy(orgId: string, category: string, action: string, updatedBy: string): Promise<void> {
  const response = await supabaseService("/rest/v1/org_policies?on_conflict=organization_id,category", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ organization_id: orgId, category, action, updated_by: updatedBy, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error("ORG_STORAGE_ERROR");
}

export async function clearOrgPolicy(orgId: string, category: string): Promise<void> {
  const response = await supabaseService(`/rest/v1/org_policies?organization_id=eq.${encodeURIComponent(orgId)}&category=eq.${encodeURIComponent(category)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("ORG_STORAGE_ERROR");
}

/** Everything /api/scan needs about the caller's organization in ONE REST
 *  round-trip (PostgREST embedding): membership, shared terms, policies.
 *  Null when the user has no organization. */
export async function orgScanContextFor(userId: string): Promise<{ organizationId: string; terms: string[]; policies: OrgPolicyRow[] } | null> {
  const response = await supabaseService(`/rest/v1/organization_members?user_id=eq.${encodeURIComponent(userId)}&select=organization_id,organizations(protected_terms(term),org_policies(category,action))`, { method: "GET" });
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ organization_id: string; organizations?: { protected_terms?: { term: string }[]; org_policies?: OrgPolicyRow[] } | null }>;
  const row = rows[0];
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    terms: (row.organizations?.protected_terms ?? []).map((t) => t.term),
    policies: row.organizations?.org_policies ?? []
  };
}

export async function protectedTermsFor(orgId: string): Promise<ProtectedTerm[]> {
  const response = await supabaseService(`/rest/v1/protected_terms?organization_id=eq.${encodeURIComponent(orgId)}&select=id,term,created_at&order=created_at.asc`, { method: "GET" });
  if (!response.ok) throw new Error("ORG_STORAGE_ERROR");
  return response.json() as Promise<ProtectedTerm[]>;
}

export async function addProtectedTerm(orgId: string, term: string, createdBy: string): Promise<void> {
  const response = await supabaseService("/rest/v1/protected_terms", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ organization_id: orgId, term, created_by: createdBy })
  });
  if (!response.ok) throw new Error("ORG_STORAGE_ERROR");
}

export async function removeProtectedTerm(orgId: string, termId: string): Promise<void> {
  const response = await supabaseService(`/rest/v1/protected_terms?id=eq.${encodeURIComponent(termId)}&organization_id=eq.${encodeURIComponent(orgId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("ORG_STORAGE_ERROR");
}

export async function userForCustomer(customerId: string): Promise<string | null> {
  const response = await supabaseService(`/rest/v1/billing_accounts?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id`, { method: "GET" });
  if (!response.ok) throw new Error("BILLING_STORAGE_ERROR");
  const rows = await response.json() as Array<{ user_id?: string }>;
  return rows[0]?.user_id ?? null;
}

export async function patchAccount(userId: string, updates: Json): Promise<void> {
  const response = await supabaseService(`/rest/v1/billing_accounts?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH", body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() })
  });
  if (!response.ok) {
    console.error("patchAccount PATCH failed:", response.status, await response.text());
    throw new Error("BILLING_STORAGE_ERROR");
  }
}

export async function claimStripeEvent(eventId: string, eventType: string): Promise<"claimed" | "completed" | "in_progress"> {
  const response = await supabaseService("/rest/v1/rpc/claim_stripe_event", { method: "POST", body: JSON.stringify({ p_event_id: eventId, p_event_type: eventType }) });
  if (!response.ok) throw new Error("BILLING_STORAGE_ERROR");
  return response.json() as Promise<"claimed" | "completed" | "in_progress">;
}

export async function completeStripeEvent(eventId: string): Promise<void> {
  const response = await supabaseService("/rest/v1/rpc/complete_stripe_event", { method: "POST", body: JSON.stringify({ p_event_id: eventId }) });
  if (!response.ok) throw new Error("BILLING_STORAGE_ERROR");
}

export function parseJson(body: unknown): Json {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_REQUEST");
  return body as Json;
}

export const appUrl = (): string => process.env.APP_URL?.replace(/\/$/, "") ?? "https://promptshield-beta.vercel.app";
