-- The billing row serializes seat reservations, acceptance and removal.
-- API identity remains authoritative; these RPCs are service-role-only.
create or replace function public.create_team_invite(p_owner_user_id uuid, p_token text)
returns public.team_invites
language plpgsql security definer set search_path = public
as $$
declare
  account public.billing_accounts;
  invitation public.team_invites;
  org_id uuid;
begin
  select * into account from public.billing_accounts where user_id = p_owner_user_id for update;
  if not found or account.plan is distinct from 'business' or coalesce(account.subscription_status, '') not in ('active', 'trialing') then
    raise exception 'TEAM_PLAN_REQUIRED';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{32}$' then raise exception 'TEAM_INVALID'; end if;
  if (select count(*) from public.team_invites where owner_user_id = p_owner_user_id and status in ('pending', 'accepted')) >= account.seat_count - 1 then
    raise exception 'TEAM_FULL';
  end if;
  insert into public.organizations(owner_user_id) values (p_owner_user_id) on conflict (owner_user_id) do nothing;
  select id into org_id from public.organizations where owner_user_id = p_owner_user_id;
  insert into public.organization_members(organization_id, user_id, role) values (org_id, p_owner_user_id, 'owner') on conflict (user_id) do nothing;
  if not exists (select 1 from public.organization_members where user_id = p_owner_user_id and organization_id = org_id and role = 'owner') then
    raise exception 'TEAM_MEMBERSHIP_CONFLICT';
  end if;
  insert into public.team_invites(owner_user_id, token) values (p_owner_user_id, p_token) returning * into invitation;
  return invitation;
end;
$$;

create or replace function public.accept_team_invite(p_token text, p_member_user_id uuid)
returns public.team_invites
language plpgsql security definer set search_path = public
as $$
declare
  owner_id uuid;
  account public.billing_accounts;
  invitation public.team_invites;
  org_id uuid;
begin
  select owner_user_id into owner_id from public.team_invites where token = p_token;
  if not found then return null; end if;
  -- Lock order matches create/revoke: owner billing first, then invitation.
  select * into account from public.billing_accounts where user_id = owner_id for update;
  if not found or account.plan is distinct from 'business' or coalesce(account.subscription_status, '') not in ('active', 'trialing') then
    raise exception 'TEAM_PLAN_REQUIRED';
  end if;
  select * into invitation from public.team_invites where token = p_token and status = 'pending' for update;
  if not found then return null; end if;
  if owner_id = p_member_user_id then raise exception 'TEAM_SELF'; end if;
  if (select count(*) from public.team_invites where owner_user_id = owner_id and status = 'accepted') >= account.seat_count - 1 then
    raise exception 'TEAM_FULL';
  end if;
  if exists (select 1 from public.organization_members where user_id = p_member_user_id)
     or exists (select 1 from public.team_invites where member_user_id = p_member_user_id and status = 'accepted') then
    raise exception 'TEAM_MEMBERSHIP_CONFLICT';
  end if;
  insert into public.organizations(owner_user_id) values (owner_id) on conflict (owner_user_id) do nothing;
  select id into org_id from public.organizations where owner_user_id = owner_id;
  insert into public.organization_members(organization_id, user_id, role) values (org_id, owner_id, 'owner') on conflict (user_id) do nothing;
  if not exists (select 1 from public.organization_members where user_id = owner_id and organization_id = org_id and role = 'owner') then
    raise exception 'TEAM_MEMBERSHIP_CONFLICT';
  end if;
  insert into public.organization_members(organization_id, user_id, role) values (org_id, p_member_user_id, 'member');
  update public.team_invites set member_user_id = p_member_user_id, status = 'accepted', accepted_at = now()
    where id = invitation.id returning * into invitation;
  return invitation;
exception when unique_violation then
  -- Concurrent acceptance into different organizations rolls back both writes.
  raise exception 'TEAM_MEMBERSHIP_CONFLICT';
end;
$$;

create or replace function public.revoke_team_invite(p_owner_user_id uuid, p_invite_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  invitation public.team_invites;
begin
  perform 1 from public.billing_accounts where user_id = p_owner_user_id for update;
  if not found then return false; end if;
  select * into invitation from public.team_invites
    where id = p_invite_id and owner_user_id = p_owner_user_id and status in ('pending', 'accepted') for update;
  if not found then return false; end if;
  if invitation.status = 'accepted' then
    delete from public.organization_members m using public.organizations o
      where m.organization_id = o.id and o.owner_user_id = p_owner_user_id
        and m.user_id = invitation.member_user_id and m.role <> 'owner';
  end if;
  update public.team_invites set status = 'revoked' where id = invitation.id;
  return true;
end;
$$;

revoke all on function public.create_team_invite(uuid, text) from public, anon, authenticated;
revoke all on function public.accept_team_invite(text, uuid) from public, anon, authenticated;
revoke all on function public.revoke_team_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_team_invite(uuid, text) to service_role;
grant execute on function public.accept_team_invite(text, uuid) to service_role;
grant execute on function public.revoke_team_invite(uuid, uuid) to service_role;
