-- Rollback of migrations/20261031_account_deletion.sql. Run it only after
-- deploying code that no longer calls delete_redaxa_account (the "Delete
-- account" action in Account & team); nothing else uses it.
drop function if exists public.delete_redaxa_account(uuid);
