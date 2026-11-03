-- Consent before Stripe (owner decision, 3 November 2026): one row each time a
-- customer ticks the Terms box on /checkout (api/_consent.ts), written before
-- the Checkout Session is created. Proof of consent and evidence for payment
-- disputes, as privacy.html says: IP address, Terms version, time, browser
-- family, plan, Stripe checkout session id. Kept 13 months, then deleted by the
-- cron sweep (api/billing.ts); no foreign key to auth.users on purpose, so the
-- row outlives an account deletion for those 13 months.
--
-- Apply before setting CHECKOUT_CONSENT=required on Vercel; until then nothing
-- writes here. Rollback: supabase/rollback/20261103_checkout_consents.sql.
create table if not exists public.checkout_consents (
  id uuid primary key,
  user_id uuid not null,
  product text not null default 'redaxa',
  plan text not null check (plan in ('personal', 'business')),
  billing_interval text not null check (billing_interval in ('monthly', 'yearly')),
  seats integer not null check (seats between 1 and 3),
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent_family text,
  checkout_session_id text unique
);

create index if not exists checkout_consents_accepted_at on public.checkout_consents (accepted_at);
create index if not exists checkout_consents_user on public.checkout_consents (user_id);

alter table public.checkout_consents enable row level security;
-- No policies: browsers never read or write it (see 20260813_table_grants.sql).
revoke all on public.checkout_consents from anon, authenticated;
grant select, insert, update, delete on public.checkout_consents to service_role;
