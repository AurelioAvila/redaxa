-- Organization policies: one row per (organization, detection category),
-- choosing what happens when that category is found in a member's prompt.
-- Absent rows fall back to the default personal policy, so an organization
-- that never touches this table behaves exactly as before.
create table if not exists public.org_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null check (category in ('personal', 'credentials', 'financial', 'custom')),
  action text not null check (action in ('warn', 'redact', 'block')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, category)
);

create index if not exists org_policies_org_idx
  on public.org_policies (organization_id);

alter table public.org_policies enable row level security;

-- Members can read their org's policies (the UI shows everyone the rules
-- they are subject to); writes go through the server, where the owner/admin
-- role check lives.
drop policy if exists "Members can read org policies" on public.org_policies;
create policy "Members can read org policies"
  on public.org_policies for select
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

revoke all on table public.org_policies from anon;
grant select, insert, update, delete on public.org_policies to service_role;
grant select on table public.org_policies to authenticated;
