import { acceptTeamInvite, accountFor, addOrganizationMember, addProtectedTerm, appUrl, clearOrgPolicy, orgPoliciesFor, setOrgPolicy, corsHeaders, createTeamInvite, ensureOrganization, hasActiveEntitlement, inviteByToken, organizationById, organizationMembers, organizationMembershipFor, protectedTermsFor, removeProtectedTerm, renameOrganization, requireUser, revokeTeamInvite, supabaseUserById, teamInvitesFor } from "./_billing.js";
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

  // GET ?action=org — the caller's organization: name, members (with roles),
  // shared protected terms. For a business owner without an org yet the org is
  // provisioned on first read, so the feature simply appears for existing
  // customers without any migration step on their side.
  if (request.method === "GET" && action === "org") {
    response.setHeader("Cache-Control", "no-store");
    try {
      const user = await requireUser(request, response);
      let membership = await organizationMembershipFor(user.id);
      if (!membership) {
        const account = await accountFor(user.id);
        if (hasActiveEntitlement(account) && account?.plan === "business") {
          await ensureOrganization(user.id);
          membership = await organizationMembershipFor(user.id);
        }
      }
      if (!membership) { response.status(200).json({ organization: null }); return; }
      const [org, members, terms, policies] = await Promise.all([
        organizationById(membership.organization_id),
        organizationMembers(membership.organization_id),
        protectedTermsFor(membership.organization_id),
        orgPoliciesFor(membership.organization_id)
      ]);
      // Member emails via the auth admin API; capped so a pathological member
      // list can't fan out into dozens of upstream calls.
      const emails = await Promise.all(members.slice(0, 10).map(async (member) => (await supabaseUserById(member.user_id))?.email ?? null));
      response.status(200).json({
        organization: org ? { id: org.id, name: org.name, createdAt: org.created_at } : null,
        role: membership.role,
        members: members.map((member, index) => ({ role: member.role, joinedAt: member.joined_at, email: emails[index] ?? null, you: member.user_id === user.id })),
        protectedTerms: terms.map((term) => ({ id: term.id, term: term.term })),
        policies: policies.map((policy) => ({ category: policy.category, action: policy.action, minSeverity: policy.min_severity ?? null }))
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "ORG_ERROR";
      response.status(message === "UNAUTHORIZED" ? 401 : 500).json({ error: message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "We could not load your organization." });
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
    const body = (request.body ?? {}) as { token?: unknown; inviteId?: unknown; name?: unknown; term?: unknown; termId?: unknown; category?: unknown; action?: unknown; minSeverity?: unknown };

    // Organization management. Writes require the owner or admin role — the
    // single place this is enforced, matching the RLS design (server-only
    // writes, role checks in the API).
    if (action === "org-rename" || action === "term-add" || action === "term-remove" || action === "policy-set") {
      const membership = await organizationMembershipFor(user.id);
      if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
        response.status(403).json({ error: "Only organization owners and admins can change this." });
        return;
      }
      if (action === "org-rename") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (name.length < 1 || name.length > 80) { response.status(400).json({ error: "Organization name must be 1-80 characters." }); return; }
        await renameOrganization(membership.organization_id, name);
      } else if (action === "term-add") {
        const term = typeof body.term === "string" ? body.term.trim() : "";
        if (term.length < 2 || term.length > 64) { response.status(400).json({ error: "A protected term must be 2-64 characters." }); return; }
        const existing = await protectedTermsFor(membership.organization_id);
        if (existing.length >= 30) { response.status(409).json({ error: "You can protect up to 30 terms." }); return; }
        await addProtectedTerm(membership.organization_id, term, user.id);
      } else if (action === "policy-set") {
        // action "default" clears the override so the category falls back to
        // the stock personal policy.
        const category = typeof body.category === "string" ? body.category : "";
        const policyAction = typeof body.action === "string" ? body.action : "";
        if (!["personal", "credentials", "financial", "custom"].includes(category)) { response.status(400).json({ error: "Unknown category." }); return; }
        const rawSeverity = typeof body.minSeverity === "string" ? body.minSeverity : "";
        const minSeverity = ["low", "medium", "high", "critical"].includes(rawSeverity) ? rawSeverity : null;
        if (policyAction === "default") await clearOrgPolicy(membership.organization_id, category);
        else if (["warn", "redact", "block"].includes(policyAction)) await setOrgPolicy(membership.organization_id, category, policyAction, user.id, minSeverity);
        else { response.status(400).json({ error: "Unknown action." }); return; }
      } else {
        const termId = typeof body.termId === "string" ? body.termId : "";
        if (!termId) { response.status(400).json({ error: "Missing term id." }); return; }
        await removeProtectedTerm(membership.organization_id, termId);
      }
      response.status(200).json({ ok: true });
      return;
    }

    if (action === "accept") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!token) { response.status(400).json({ error: "Missing invite link." }); return; }
      const pending = await inviteByToken(token);
      if (!pending || pending.status !== "pending") { response.status(410).json({ error: "That invite link is no longer valid." }); return; }
      if (pending.owner_user_id === user.id) { response.status(400).json({ error: "You can't accept your own invite." }); return; }
      const invite = await acceptTeamInvite(token, user.id);
      if (!invite) { response.status(410).json({ error: "That invite link is no longer valid." }); return; }
      // Joining a team now also means joining the owner's organization, so
      // shared protected terms and org-level audit apply from the first scan.
      try {
        const org = await ensureOrganization(pending.owner_user_id);
        if (org) await addOrganizationMember(org.id, user.id, "member");
      } catch {
        // Org linkage is best-effort here; the next `?action=org` read repairs it.
      }
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
