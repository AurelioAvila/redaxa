import { accountFor, corsHeaders, effectiveEntitlement, requireUser } from "./_billing.js";

type RequestLike = { method?: string; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") { response.setHeader("Allow", "GET"); response.status(405).end(); return; }
  response.setHeader("Cache-Control", "no-store");
  try {
    const user = await requireUser(request, response);
    const entitlement = await effectiveEntitlement(user.id);
    const account = entitlement.account ?? await accountFor(user.id);
    response.status(200).json({
      email: user.email,
      active: entitlement.active,
      status: account?.subscription_status ?? null,
      currentPeriodEnd: account?.current_period_end ?? null,
      plan: account?.plan ?? null,
      teamRole: entitlement.role,
      teamOwnerEmail: entitlement.ownerEmail
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ACCOUNT_ERROR";
    response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not load your account." });
  }
}
