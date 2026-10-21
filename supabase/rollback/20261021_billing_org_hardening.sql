-- Rollback of migrations/20261021_billing_org_hardening.sql: puts back the
-- definitions of 20260811_billing.sql, 20260821_organizations.sql and
-- 20260821_org_policies.sql. Run it only after deploying code that no longer
-- calls leave_organization (the "Leave workspace" action); everything else
-- keeps working, with the old weaknesses back.
begin;

create or replace function public.claim_stripe_event(p_event_id text, p_event_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.processed_stripe_events;
begin
  insert into public.processed_stripe_events (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing;

  select * into event_row from public.processed_stripe_events where event_id = p_event_id for update;
  if event_row.processing_state = 'completed' then return 'completed'; end if;
  if event_row.updated_at > now() - interval '5 minutes' and event_row.processed_at <> event_row.updated_at then
    return 'in_progress';
  end if;
  update public.processed_stripe_events set updated_at = now() where event_id = p_event_id;
  return 'claimed';
end;
$$;

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

drop policy if exists "Members can read their organization" on public.organizations;
create policy "Members can read their organization"
  on public.organizations for select
  using (id in (select organization_id from public.organization_members where user_id = auth.uid()));

drop policy if exists "Members can read the member list" on public.organization_members;
create policy "Members can read the member list"
  on public.organization_members for select
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

drop policy if exists "Members can read protected terms" on public.protected_terms;
create policy "Members can read protected terms"
  on public.protected_terms for select
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

drop policy if exists "Members can read org policies" on public.org_policies;
create policy "Members can read org policies"
  on public.org_policies for select
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

drop function if exists public.my_organization_ids();
drop function if exists public.leave_organization(uuid);

commit;
