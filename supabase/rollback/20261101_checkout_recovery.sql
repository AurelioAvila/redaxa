-- Rollback of migrations/20261101_checkout_recovery.sql. Safe at any time:
-- without these objects the sweep claims nothing and sends nothing.
drop function if exists public.claim_redaxa_checkout_recovery(uuid, text, text);
drop table if exists public.redaxa_checkout_recovery;
