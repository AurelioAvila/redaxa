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

export function setSessionCookies(response: { setHeader(name: string, value: string | string[]): void; getHeader?(name: string): unknown }, accessToken: string, refreshToken: string, expiresIn: number): void {
  const refreshMaxAge = 60 * 60 * 24 * 30;
  response.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=${encodeURIComponent(accessToken)}; ${cookieAttributes(expiresIn)}`,
    `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}; ${cookieAttributes(refreshMaxAge)}`
  ]);
}

export function clearSessionCookies(response: { setHeader(name: string, value: string | string[]): void }): void {
  response.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=; ${cookieAttributes(null)}`,
    `${REFRESH_COOKIE}=; ${cookieAttributes(null)}`
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

async function supabase(path: string, init: RequestInit = {}): Promise<Response> {
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
  return new Set([appUrl(), "tauri://localhost", "http://tauri.localhost"]);
}

export function corsHeaders(request: { headers?: Record<string, string | string[] | undefined> }): Record<string, string> {
  const rawOrigin = request.headers?.origin;
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins().has(origin) ? origin : appUrl(),
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
        setSessionCookies(response, refreshed.access_token, refreshed.refresh_token, refreshed.expires_in);
        return user;
      }
    }
  }
  throw new Error("UNAUTHORIZED");
}

export async function reserveCheckout(userId: string): Promise<BillingAccount> {
  const response = await supabase("/rest/v1/rpc/reserve_billing_checkout", {
    method: "POST", body: JSON.stringify({ p_user_id: userId })
  });
  if (!response.ok) {
    const detail = await response.text();
    if (detail.includes("active subscription")) throw new Error("ACTIVE_SUBSCRIPTION");
    if (detail.includes("already being prepared")) throw new Error("CHECKOUT_IN_PROGRESS");
    throw new Error("BILLING_STORAGE_ERROR");
  }
  return response.json() as Promise<BillingAccount>;
}

export async function releaseCheckout(userId: string): Promise<void> {
  await supabase(`/rest/v1/billing_accounts?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH", body: JSON.stringify({ checkout_lock_at: null })
  });
}

export async function saveCustomer(userId: string, customerId: string): Promise<void> {
  const response = await supabase(`/rest/v1/billing_accounts?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH", body: JSON.stringify({ stripe_customer_id: customerId })
  });
  if (!response.ok) throw new Error("BILLING_STORAGE_ERROR");
}

export async function accountFor(userId: string): Promise<BillingAccount | null> {
  const response = await supabase(`/rest/v1/billing_accounts?user_id=eq.${encodeURIComponent(userId)}&select=stripe_customer_id,stripe_subscription_id,has_used_trial,subscription_status,current_period_end,plan,seat_count`, { method: "GET" });
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

async function supabaseUserById(userId: string): Promise<{ email?: string } | null> {
  const response = await supabase(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "GET" });
  if (!response.ok) return null;
  return response.json() as Promise<{ email?: string }>;
}

export async function teamMembershipFor(userId: string): Promise<TeamInvite | null> {
  const response = await supabase(`/rest/v1/team_invites?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.accepted&select=*`, { method: "GET" });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
  const rows = await response.json() as TeamInvite[];
  return rows[0] ?? null;
}

export async function teamInvitesFor(ownerUserId: string): Promise<TeamInvite[]> {
  const response = await supabase(`/rest/v1/team_invites?owner_user_id=eq.${encodeURIComponent(ownerUserId)}&status=in.(pending,accepted)&select=*&order=created_at.asc`, { method: "GET" });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
  return response.json() as Promise<TeamInvite[]>;
}

export async function createTeamInvite(ownerUserId: string): Promise<TeamInvite> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const response = await supabase("/rest/v1/team_invites", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ owner_user_id: ownerUserId, token })
  });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
  const rows = await response.json() as TeamInvite[];
  return rows[0];
}

export async function revokeTeamInvite(ownerUserId: string, inviteId: string): Promise<void> {
  const response = await supabase(`/rest/v1/team_invites?id=eq.${encodeURIComponent(inviteId)}&owner_user_id=eq.${encodeURIComponent(ownerUserId)}&status=eq.pending`, {
    method: "PATCH", body: JSON.stringify({ status: "revoked" })
  });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
}

export async function inviteByToken(token: string): Promise<TeamInvite | null> {
  const response = await supabase(`/rest/v1/team_invites?token=eq.${encodeURIComponent(token)}&select=*`, { method: "GET" });
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
  const response = await supabase(`/rest/v1/team_invites?token=eq.${encodeURIComponent(token)}&status=eq.pending`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ member_user_id: memberUserId, status: "accepted", accepted_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error("TEAM_STORAGE_ERROR");
  const rows = await response.json() as TeamInvite[];
  return rows[0] ?? null;
}

export async function userForCustomer(customerId: string): Promise<string | null> {
  const response = await supabase(`/rest/v1/billing_accounts?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id`, { method: "GET" });
  if (!response.ok) throw new Error("BILLING_STORAGE_ERROR");
  const rows = await response.json() as Array<{ user_id?: string }>;
  return rows[0]?.user_id ?? null;
}

export async function patchAccount(userId: string, updates: Json): Promise<void> {
  const response = await supabase(`/rest/v1/billing_accounts?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH", body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error("BILLING_STORAGE_ERROR");
}

export async function claimStripeEvent(eventId: string, eventType: string): Promise<"claimed" | "completed" | "in_progress"> {
  const response = await supabase("/rest/v1/rpc/claim_stripe_event", { method: "POST", body: JSON.stringify({ p_event_id: eventId, p_event_type: eventType }) });
  if (!response.ok) throw new Error("BILLING_STORAGE_ERROR");
  return response.json() as Promise<"claimed" | "completed" | "in_progress">;
}

export async function completeStripeEvent(eventId: string): Promise<void> {
  const response = await supabase("/rest/v1/rpc/complete_stripe_event", { method: "POST", body: JSON.stringify({ p_event_id: eventId }) });
  if (!response.ok) throw new Error("BILLING_STORAGE_ERROR");
}

export function parseJson(body: unknown): Json {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_REQUEST");
  return body as Json;
}

export const appUrl = (): string => process.env.APP_URL?.replace(/\/$/, "") ?? "https://promptshield-beta.vercel.app";
