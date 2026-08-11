import { accountFor, appUrl, requireUser, stripe } from "./_billing.js";

type RequestLike = { method?: string; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).end(); return; }
  try {
    const user = await requireUser(request);
    const account = await accountFor(user.id);
    if (!account?.stripe_customer_id) { response.status(400).json({ error: "No subscription is attached to this account yet." }); return; }
    const session = await stripe.billingPortal.sessions.create({ customer: account.stripe_customer_id, return_url: `${appUrl()}/?billing=managed` });
    response.status(200).json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PORTAL_ERROR";
    response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not open billing management." });
  }
}
