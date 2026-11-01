-- "Your payment didn't go through" (owner decision, 1 November 2026): one
-- email when a signed-in customer's checkout payment fails or Stripe blocks
-- it, at most one per account and plan every 24 hours. Apply before
-- deploying the code that calls it; until then the sweep claims nothing and
-- sends nothing. Rollback: supabase/rollback/20261101_checkout_recovery.sql.
--
-- Only the account id, the plan and Stripe's payment id, kept for a day: each
-- claim first deletes rows older than 24 hours, so a deleted account leaves
-- nothing here for long without a change to delete_redaxa_account.
create table if not exists public.redaxa_checkout_recovery (
  user_id uuid not null,
  plan text not null,
  payment_id text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, plan)
);

alter table public.redaxa_checkout_recovery enable row level security;
-- No policies: browsers never read or write it (see 20260813_table_grants.sql).
revoke all on public.redaxa_checkout_recovery from anon, authenticated;
grant select, insert, delete on public.redaxa_checkout_recovery to service_role;

-- True when this call may send the email: no email for this account and plan
-- in the last 24 hours. The primary key decides, so two sweeps running at the
-- same moment cannot both send.
create or replace function public.claim_redaxa_checkout_recovery(p_user_id uuid, p_plan text, p_payment_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.redaxa_checkout_recovery where sent_at < now() - interval '24 hours';
  insert into public.redaxa_checkout_recovery (user_id, plan, payment_id) values (p_user_id, p_plan, p_payment_id)
  on conflict (user_id, plan) do nothing;
  return found;
end;
$$;

revoke all on function public.claim_redaxa_checkout_recovery(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_redaxa_checkout_recovery(uuid, text, text) to service_role;
