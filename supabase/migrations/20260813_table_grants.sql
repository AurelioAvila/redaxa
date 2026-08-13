-- Second half of the permission fix from 20260813_grants.sql: it turns out
-- service_role never had direct table privileges either, not just function
-- EXECUTE. This project's tables were created by hand in the SQL editor,
-- which does not automatically pick up Supabase's usual default-privilege
-- grants for service_role the way tables created through the dashboard/CLI
-- normally do. Confirmed via Postgres's own error: "permission denied for
-- table billing_accounts" with the exact GRANT it wanted in the hint.
-- RLS remains enabled and untouched -- this only affects the service role,
-- which already bypasses RLS; it still needs the underlying table grant to
-- get past Postgres's privilege check before RLS is even evaluated.
grant select, insert, update, delete on public.billing_accounts to service_role;
grant select, insert, update, delete on public.team_invites to service_role;
grant select, insert, update on public.processed_stripe_events to service_role;
