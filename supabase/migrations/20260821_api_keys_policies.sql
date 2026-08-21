-- 1) Dedicated API keys. The key itself is NEVER stored: only a SHA-256
-- hash (for lookup) and a display prefix (so the user can tell keys apart).
-- A leaked database row cannot be turned back into a working key.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'API key' check (char_length(name) between 1 and 60),
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_keys_user_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;

-- Users can read their own key METADATA (name, prefix, dates). All writes go
-- through the server; there is no value column to leak by construction.
drop policy if exists "Users can read their own API keys" on public.api_keys;
create policy "Users can read their own API keys"
  on public.api_keys for select
  using (auth.uid() = user_id);

revoke all on table public.api_keys from anon;
grant select, insert, update on public.api_keys to service_role;
grant select on table public.api_keys to authenticated;

-- 2) Organization policies gain an optional severity threshold: a rule can
-- now say "personal data at high severity or above". NULL keeps the old
-- behavior (any severity triggers).
alter table public.org_policies
  add column if not exists min_severity text
  check (min_severity is null or min_severity in ('low', 'medium', 'high', 'critical'));
