-- Three-day free trial (owner decision, 14 October 2026): one trial per
-- account, per normalised email and, where Stripe gives one, per card.
-- Apply BEFORE setting TRIAL_ENABLED=true; with the switch off nothing reads
-- or writes these objects. Rollback: supabase/rollback/20261014_trial_claims.sql.
--
-- One row per trial ever started under the rule. Only a SHA-256 of the
-- normalised email and Stripe's card fingerprint are kept, never the address
-- or the card. No foreign key to auth.users on purpose: the row outlives a
-- deleted account, or deleting and re-creating it would buy a second trial.
create table if not exists public.redaxa_trial_claims (
  subscription_id text primary key,
  user_id uuid not null unique,
  email_hash text not null unique check (email_hash ~ '^[0-9a-f]{64}$'),
  card_fingerprint text unique,
  trial_end timestamptz,
  reminded_for timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists redaxa_trial_claims_due on public.redaxa_trial_claims (trial_end) where reminded_for is null;

alter table public.redaxa_trial_claims enable row level security;
-- No policies: browsers never read or write it. Tables created in the SQL
-- editor do not get Supabase's default grants, so the service role is granted
-- explicitly (see 20260813_table_grants.sql).
revoke all on public.redaxa_trial_claims from anon, authenticated;
grant select, insert, update on public.redaxa_trial_claims to service_role;

-- Nobody with this account or this mailbox has had the trial.
create or replace function public.redaxa_trial_available(p_user_id uuid, p_email_hash text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.redaxa_trial_claims where user_id = p_user_id or email_hash = p_email_hash
  );
$$;

-- Records the trial of one subscription. True when that subscription holds
-- the claim (first time, or the same event replayed); false when the
-- account, the mailbox or the card already had a trial. The unique indexes
-- decide, so two checkouts finishing at the same moment cannot both win.
create or replace function public.claim_redaxa_trial(
  p_subscription_id text,
  p_user_id uuid,
  p_email_hash text,
  p_card_fingerprint text,
  p_trial_end timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.redaxa_trial_claims (subscription_id, user_id, email_hash, card_fingerprint, trial_end)
  values (p_subscription_id, p_user_id, p_email_hash, nullif(p_card_fingerprint, ''), p_trial_end)
  on conflict do nothing;
  return exists (select 1 from public.redaxa_trial_claims where subscription_id = p_subscription_id);
end;
$$;

revoke all on function public.redaxa_trial_available(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_redaxa_trial(text, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.redaxa_trial_available(uuid, text) to service_role;
grant execute on function public.claim_redaxa_trial(text, uuid, text, text, timestamptz) to service_role;
