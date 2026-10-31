-- Self-service account deletion (31 Oct 2026). Rollback:
-- supabase/rollback/20261031_account_deletion.sql.
--
-- Removes every Redaxa row of one account in a single transaction. The API
-- calls it after cancelling the account's Stripe subscriptions, then deletes
-- the sign-in itself (Supabase Auth). The sign-in is shared with Frame
-- Witness, so the API keeps it when Frame Witness still holds a licence or a
-- trial for it: the rows below therefore cannot rely on the auth.users
-- cascades, and the service role has no DELETE grant on api_keys,
-- user_settings or scan_events. redaxa_trial_claims stays on purpose (see
-- 20261014_trial_claims.sql and the privacy policy).
--
-- Returns the owner of the workspace the account belonged to as a member, so
-- the API can tell them the seat is free again, or null.
create or replace function public.delete_redaxa_account(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace_owner uuid;
begin
  select o.owner_user_id into workspace_owner
  from public.organization_members m join public.organizations o on o.id = m.organization_id
  where m.user_id = p_user_id and o.owner_user_id <> p_user_id;
  -- The same lock leave_organization takes: seats are counted under it.
  if workspace_owner is not null then
    perform 1 from public.billing_accounts where user_id = workspace_owner for update;
  end if;
  -- An owned workspace takes its members, protected terms and policies with it.
  delete from public.organizations where owner_user_id = p_user_id;
  delete from public.organization_members where user_id = p_user_id;
  delete from public.team_invites where owner_user_id = p_user_id or member_user_id = p_user_id;
  -- Terms and policies the account set in someone else's workspace belong to
  -- that workspace; only the pointer to this account goes.
  update public.protected_terms set created_by = null where created_by = p_user_id;
  update public.org_policies set updated_by = null where updated_by = p_user_id;
  delete from public.api_keys where user_id = p_user_id;
  delete from public.user_settings where user_id = p_user_id;
  delete from public.scan_events where user_id = p_user_id;
  delete from public.billing_accounts where user_id = p_user_id;
  return workspace_owner;
end;
$$;

revoke all on function public.delete_redaxa_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_redaxa_account(uuid) to service_role;
