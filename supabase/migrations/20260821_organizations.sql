-- Organizations: the workspace model that replaces "owner + invites" as the
-- unit of governance. Entitlement still flows from the owner's subscription
-- (billing is unchanged); the organization is the identity layer that policies,
-- protected terms and audit aggregate on.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Workspace' check (char_length(name) between 1 and 80),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- One organization per user for now: mirrors the existing "one team per
  -- member" rule of team_invites, and keeps effectiveEntitlement unambiguous.
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now()
);

create index if not exists organization_members_org_idx
  on public.organization_members (organization_id);

-- Protected terms, server-side and workspace-scoped: what used to live only
-- in one browser's localStorage becomes a rule the whole organization shares.
-- Only the term itself is stored — it is a word the admin CHOSE to protect
-- (a project codename, a client name), not captured user content.
create table if not exists public.protected_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  term text not null check (char_length(term) between 2 and 64),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, term)
);

create index if not exists protected_terms_org_idx
  on public.protected_terms (organization_id);

-- Audit events become aggregatable per organization.
alter table public.scan_events
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists scan_events_org_created_idx
  on public.scan_events (organization_id, created_at desc);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.protected_terms enable row level security;

-- Members can read their own org, its member list, and its protected terms.
-- All writes go through the server (service role): role checks live in one
-- place in the API instead of being duplicated as SQL policies.
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

-- Same grant convention as 20260813_table_grants.sql.
revoke all on table public.organizations from anon;
revoke all on table public.organization_members from anon;
revoke all on table public.protected_terms from anon;
grant select, insert, update, delete on public.organizations to service_role;
grant select, insert, update, delete on public.organization_members to service_role;
grant select, insert, update, delete on public.protected_terms to service_role;
grant select on table public.organizations to authenticated;
grant select on table public.organization_members to authenticated;
grant select on table public.protected_terms to authenticated;

-- Backfill: every existing business owner becomes an organization, and every
-- accepted invite becomes a membership. Idempotent (safe to re-run).
insert into public.organizations (owner_user_id)
select ba.user_id
from public.billing_accounts ba
where ba.plan = 'business'
on conflict (owner_user_id) do nothing;

insert into public.organization_members (organization_id, user_id, role)
select o.id, o.owner_user_id, 'owner'
from public.organizations o
on conflict (user_id) do nothing;

insert into public.organization_members (organization_id, user_id, role)
select o.id, ti.member_user_id, 'member'
from public.team_invites ti
join public.organizations o on o.owner_user_id = ti.owner_user_id
where ti.status = 'accepted' and ti.member_user_id is not null
on conflict (user_id) do nothing;
