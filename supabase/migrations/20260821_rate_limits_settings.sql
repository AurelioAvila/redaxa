-- 1) Shared rate limiting. The in-memory guard in the API only sees one warm
-- serverless instance; this counter is the cross-instance authority. A single
-- atomic upsert per hit: reset the window when it has expired, otherwise
-- increment, and report whether the limit is now exceeded.
create table if not exists public.rate_limit_counters (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

revoke all on table public.rate_limit_counters from anon;
revoke all on table public.rate_limit_counters from authenticated;
grant select, insert, update, delete on public.rate_limit_counters to service_role;

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limit_counters as c (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when c.window_start < now() - make_interval(secs => p_window_seconds) then 1 else c.count + 1 end,
        window_start = case when c.window_start < now() - make_interval(secs => p_window_seconds) then now() else c.window_start end
  returning c.count into v_count;
  return v_count > p_limit;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- 2) Server-side user settings: the cross-device sync for what actually
-- belongs to the person rather than the device — custom protected terms,
-- detection toggles, scan mode. Theme and language stay local by design
-- (device preferences). One row per user, a single jsonb document.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "Users can read their own settings" on public.user_settings;
create policy "Users can read their own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

revoke all on table public.user_settings from anon;
grant select, insert, update on public.user_settings to service_role;
grant select on table public.user_settings to authenticated;
