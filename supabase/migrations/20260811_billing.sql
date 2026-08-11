-- PromptShield billing state. The browser can read only its own status;
-- all Stripe-related writes are performed by the server using the service key.
create table if not exists public.billing_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan text check (plan in ('personal', 'business')),
  billing_interval text check (billing_interval in ('monthly', 'yearly')),
  seat_count smallint not null default 1 check (seat_count between 1 and 3),
  subscription_status text,
  has_used_trial boolean not null default false,
  checkout_lock_at timestamptz,
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_accounts enable row level security;

drop policy if exists "Users can read their own billing account" on public.billing_accounts;
create policy "Users can read their own billing account"
  on public.billing_accounts for select
  using (auth.uid() = user_id);

create table if not exists public.processed_stripe_events (
  event_id text primary key,
  event_type text not null,
  processing_state text not null default 'processing' check (processing_state in ('processing', 'completed')),
  processed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.processed_stripe_events enable row level security;

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

revoke all on function public.reserve_billing_checkout(uuid) from public, anon, authenticated;

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

create or replace function public.complete_stripe_event(p_event_id text)
returns void
language sql
security definer
set search_path = public
as $$ update public.processed_stripe_events set processing_state = 'completed', updated_at = now() where event_id = p_event_id; $$;

revoke all on function public.claim_stripe_event(text, text) from public, anon, authenticated;
revoke all on function public.complete_stripe_event(text) from public, anon, authenticated;

-- No public policies are deliberately created for either table.
-- The service role bypasses RLS; browser clients cannot write billing state.
