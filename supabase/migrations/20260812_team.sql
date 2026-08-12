-- Business-plan team seats. An owner (the Stripe subscriber) can invite up to
-- seat_count - 1 teammates via a shareable link (no transactional email
-- provider is configured, so this is link-based rather than email-based).
-- A member can belong to at most one team at a time, enforced below.
create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  member_user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- A user can only hold one accepted membership at a time.
create unique index if not exists team_invites_one_active_membership
  on public.team_invites (member_user_id)
  where status = 'accepted';

alter table public.team_invites enable row level security;

drop policy if exists "Owners can read their own invites" on public.team_invites;
create policy "Owners can read their own invites"
  on public.team_invites for select
  using (auth.uid() = owner_user_id or auth.uid() = member_user_id);

-- No insert/update/delete policies: only the server (service role) writes,
-- same pattern as billing_accounts, so seat limits and single-membership are
-- always enforced in application code that already knows the caller's plan.
