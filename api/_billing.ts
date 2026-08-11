import Stripe from "stripe";

type Json = Record<string, unknown>;

export type BillingUser = { id: string; email: string };
export type BillingAccount = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  has_used_trial: boolean;
};

export const stripe = new Stripe(required("STRIPE_SECRET_KEY"), { typescript: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function supabaseUrl(): string { return required("SUPABASE_URL").replace(/\/$/, ""); }
function serviceKey(): string { return required("SUPABASE_SERVICE_ROLE_KEY"); }

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

export async function requireUser(request: { headers?: Record<string, string | string[] | undefined> }): Promise<BillingUser> {
  const raw = request.headers?.authorization;
  const authorization = Array.isArray(raw) ? raw[0] : raw;
  if (!authorization?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const token = authorization.slice("Bearer ".length);
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: required("SUPABASE_PUBLISHABLE_KEY"), Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("UNAUTHORIZED");
  const body = await response.json() as { id?: string; email?: string };
  if (!body.id || !body.email) throw new Error("UNAUTHORIZED");
  return { id: body.id, email: body.email };
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
  const response = await supabase(`/rest/v1/billing_accounts?user_id=eq.${encodeURIComponent(userId)}&select=stripe_customer_id,stripe_subscription_id,has_used_trial`, { method: "GET" });
  if (!response.ok) throw new Error("BILLING_STORAGE_ERROR");
  const rows = await response.json() as BillingAccount[];
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
