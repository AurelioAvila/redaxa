-- Billing and workspace hardening (21 Oct 2026). Rollback:
-- supabase/rollback/20261021_billing_org_hardening.sql.

-- 1) Stripe events: the "in_progress" guard never fired on the first
-- duplicate. The first claim wrote processed_at and updated_at with now(),
-- which is the transaction start, so both were equal and a second delivery
-- arriving while the first was still running read as "claimed". A claim is
-- now decided by the insert itself: whoever inserts the row owns the event;
-- everyone else sees it completed, in progress, or (after five quiet minutes,
-- a handler that died half way) takes it over. clock_timestamp() is the
-- wall clock, not the transaction start.
create or replace function public.claim_stripe_event(p_event_id text, p_event_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.processed_stripe_events;
  inserted integer;
begin
  insert into public.processed_stripe_events (event_id, event_type, processed_at, updated_at)
  values (p_event_id, p_event_type, clock_timestamp(), clock_timestamp())
  on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 then return 'claimed'; end if;

  select * into event_row from public.processed_stripe_events where event_id = p_event_id for update;
  if event_row.processing_state = 'completed' then return 'completed'; end if;
  if event_row.updated_at > clock_timestamp() - interval '5 minutes' then return 'in_progress'; end if;
  update public.processed_stripe_events set updated_at = clock_timestamp() where event_id = p_event_id;
  return 'claimed';
end;
$$;

-- 2) A second checkout while a subscription still exists and can bill. Only
-- trialing/active/past_due/cancel_pending were refused, so an unpaid, paused
-- or incomplete subscription let the customer start another one and pay
-- twice once the card was updated. Those now point to Manage billing. An
-- incomplete subscription expires by itself after 23 hours; the 24-hour
-- bound keeps a missed expiry webhook from locking the account for good.
create or replace function public.reserve_billing_checkout(p_user_id uuid)
returns public.billing_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  account public.billing_accounts;
begin
  insert into public.billing_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into account
  from public.billing_accounts
  where user_id = p_user_id
  for update;

  if account.stripe_subscription_id is not null
     and account.subscription_status in ('trialing', 'active', 'past_due', 'cancel_pending') then
    raise exception 'An active subscription already exists';
  end if;

  if account.stripe_subscription_id is not null
     and (account.subscription_status in ('unpaid', 'paused')
          or (account.subscription_status = 'incomplete' and account.updated_at > now() - interval '24 hours')) then
    raise exception 'The existing subscription needs attention in billing management';
  end if;

  if account.checkout_lock_at is not null
     and account.checkout_lock_at > now() - interval '10 minutes' then
    raise exception 'A checkout session is already being prepared';
  end if;

  update public.billing_accounts
  set checkout_lock_at = now(), updated_at = now()
  where user_id = p_user_id
  returning * into account;

  return account;
end;
$$;

revoke all on function public.claim_stripe_event(text, text) from public, anon, authenticated;
revoke all on function public.reserve_billing_checkout(uuid) from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text, text) to service_role;
grant execute on function public.reserve_billing_checkout(uuid) to service_role;

-- 3) Workspace read policies queried organization_members from a policy on
-- organization_members itself: Postgres refuses that with "infinite
-- recursion detected in policy" (42P17) for any signed-in REST read. The
-- caller's organizations now come from one SECURITY DEFINER function that
-- reads only the caller's own membership row.
create or replace function public.my_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$ select organization_id from public.organization_members where user_id = auth.uid() $$;

revoke all on function public.my_organization_ids() from public, anon;
grant execute on function public.my_organization_ids() to authenticated, service_role;

drop policy if exists "Members can read their organization" on public.organizations;
create policy "Members can read their organization"
  on public.organizations for select
  using (id in (select public.my_organization_ids()));

drop policy if exists "Members can read the member list" on public.organization_members;
create policy "Members can read the member list"
  on public.organization_members for select
  using (organization_id in (select public.my_organization_ids()));

drop policy if exists "Members can read protected terms" on public.protected_terms;
create policy "Members can read protected terms"
  on public.protected_terms for select
  using (organization_id in (select public.my_organization_ids()));

drop policy if exists "Members can read org policies" on public.org_policies;
create policy "Members can read org policies"
  on public.org_policies for select
  using (organization_id in (select public.my_organization_ids()));

-- 4) Leaving a workspace. A member or admin removes their own membership
-- and frees the seat. The owner cannot leave: an organization has exactly
-- one owner (organizations.owner_user_id is unique), so the owner is always
-- the last one. Lock order matches create/accept/revoke: the owner's billing
-- row first, then the membership.
create or replace function public.leave_organization(p_member_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  membership public.organization_members;
begin
  select o.owner_user_id into owner_id
  from public.organization_members m join public.organizations o on o.id = m.organization_id
  where m.user_id = p_member_user_id;
  if not found then return null; end if;
  perform 1 from public.billing_accounts where user_id = owner_id for update;
  select * into membership from public.organization_members where user_id = p_member_user_id for update;
  if not found then return null; end if;
  if membership.role = 'owner' then raise exception 'TEAM_OWNER_CANNOT_LEAVE'; end if;
  delete from public.organization_members where id = membership.id;
  update public.team_invites set status = 'revoked'
    where owner_user_id = owner_id and member_user_id = p_member_user_id and status = 'accepted';
  return owner_id;
end;
$$;

revoke all on function public.leave_organization(uuid) from public, anon, authenticated;
grant execute on function public.leave_organization(uuid) to service_role;
