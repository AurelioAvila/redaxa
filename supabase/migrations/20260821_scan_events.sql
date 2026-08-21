-- Scan events: the metadata-first audit trail. One row per completed scan.
--
-- Privacy by construction: there is NO column for the prompt text, NO column
-- for finding values. What a scan found is recorded only as kinds/categories/
-- count plus the policy decision — enough for activity, reporting and future
-- org audit, useless as a trove of sensitive content. If a future enterprise
-- customer needs content retention, that will be a separate, explicit,
-- opt-in capability — never a widening of this table.
create table if not exists public.scan_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Self-reported surface ("web", "extension", "chatgpt", ...), allowlisted
  -- server-side; grants nothing, informs reporting.
  application text not null default 'unknown',
  finding_kinds text[] not null default '{}',
  finding_categories text[] not null default '{}',
  finding_count integer not null default 0 check (finding_count >= 0),
  -- The policy decision: allow / warn / redact / block.
  action text not null default 'allow' check (action in ('allow', 'warn', 'redact', 'block'))
);

create index if not exists scan_events_user_created_idx
  on public.scan_events (user_id, created_at desc);

alter table public.scan_events enable row level security;

-- Users can read their own events. There are deliberately NO insert/update/
-- delete policies for authenticated users: rows are written only by the
-- server (service role) and are append-only from the client's point of view —
-- a user must not be able to edit or erase their audit trail through the API.
drop policy if exists "Users can read their own scan events" on public.scan_events;
create policy "Users can read their own scan events"
  on public.scan_events for select
  using (auth.uid() = user_id);

-- Mirrors 20260813_table_grants.sql: RLS policies decide *which rows*, grants
-- decide *whether the role may touch the table at all*.
revoke all on table public.scan_events from anon;
-- The server writes events with the service role; hand-created tables in this
-- project need the grant spelled out (see 20260813_table_grants.sql).
grant select, insert on public.scan_events to service_role;
grant select on table public.scan_events to authenticated;
