-- Rollback of migrations/20261103_checkout_consents.sql. Turn the switch off
-- first (remove CHECKOUT_CONSENT on Vercel and redeploy): with it on, checkout
-- needs this table. Dropping it deletes the consent records kept for disputes.
drop table if exists public.checkout_consents;
