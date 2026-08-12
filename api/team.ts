import { acceptTeamInvite, accountFor, appUrl, corsHeaders, createTeamInvite, hasActiveEntitlement, inviteByToken, requireUser, revokeTeamInvite, teamInvitesFor } from "./_billing.js";
import { clientIp, rateLimited } from "./_rateLimit.js";

type RequestLike = { method?: string; body?: unknown; query?: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string | string[]): void; status(code: number): ResponseLike; json(value: unknown): void; end(): void };

// Consolidated into one function (Vercel's Hobby plan caps a deployment at 12
// serverless functions) -- action is chosen by method + ?action= query param
// rather than by path, since the four operations share almost all their
// imports and error-shape boilerplate anyway.
export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  const cors = corsHeaders(request);
  for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
  if (request.method === "OPTIONS") { response.status(204).end(); return; }

  const action = Array.isArray(request.query?.action) ? request.query?.action[0] : request.query?.action;

  if (request.method === "GET" && (!action || action === "list")) {
    response.setHeader("Cache-Control", "no-store");
    try {
      const user = await requireUser(request, response);
      const account = await accountFor(user.id);
      const invites = account?.plan === "business" ? await teamInvitesFor(user.id) : [];
      response.status(200).json({
        seatCount: account?.seat_count ?? 1,
        seatsUsed: 1 + invites.length,
        invites: invites.map((invite) => ({ id: invite.id, status: invite.status, createdAt: invite.created_at, acceptedAt: invite.accepted_at }))
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "TEAM_ERROR";
      response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not load your team." });
    }
    return;
  }

  if (request.method !== "POST") { response.setHeader("Allow", "GET, POST"); response.status(405).end(); return; }

  try {
    const user = await requireUser(request, response);
    if (rateLimited(`team:user:${user.id}`, 20, 15 * 60_000) || rateLimited(`team:ip:${clientIp(request.headers)}`, 60, 15 * 60_000)) {
      response.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
      return;
    }
    const body = (request.body ?? {}) as { token?: unknown; inviteId?: unknown };

    if (action === "accept") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!token) { response.status(400).json({ error: "Missing invite link." }); return; }
      const pending = await inviteByToken(token);
      if (!pending || pending.status !== "pending") { response.status(410).json({ error: "That invite link is no longer valid." }); return; }
      if (pending.owner_user_id === user.id) { response.status(400).json({ error: "You can't accept your own invite." }); return; }
      const invite = await acceptTeamInvite(token, user.id);
      if (!invite) { response.status(410).json({ error: "That invite link is no longer valid." }); return; }
      response.status(200).json({ ok: true });
      return;
    }

    if (action === "revoke") {
      const inviteId = typeof body.inviteId === "string" ? body.inviteId : "";
      if (!inviteId) { response.status(400).json({ error: "Missing invite id." }); return; }
      await revokeTeamInvite(user.id, inviteId);
      response.status(200).json({ ok: true });
      return;
    }

    // Default POST action: create an invite.
    const account = await accountFor(user.id);
    if (!hasActiveEntitlement(account) || account?.plan !== "business") {
      response.status(403).json({ error: "Team invites are available on the Business plan." });
      return;
    }
    const existing = await teamInvitesFor(user.id);
    const seatsAvailable = account.seat_count - 1 - existing.length;
    if (seatsAvailable <= 0) {
      response.status(409).json({ error: "No seats available. Remove a teammate or add seats to invite more." });
      return;
    }
    const invite = await createTeamInvite(user.id);
    response.status(200).json({ token: invite.token, url: `${appUrl()}/?invite=${invite.token}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TEAM_ERROR";
    const alreadyOnATeam = message.includes("duplicate key") || message === "TEAM_STORAGE_ERROR";
    response.status(message === "UNAUTHORIZED" ? 401 : action === "accept" ? 409 : 500).json({
      error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : action === "accept" && alreadyOnATeam ? "You're already part of a team. Leave it before joining another." : "We could not complete that request."
    });
  }
}
