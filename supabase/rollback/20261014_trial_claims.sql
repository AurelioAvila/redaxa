-- Rollback of migrations/20261014_trial_claims.sql. Run only AFTER the code
-- that calls these objects is gone (or TRIAL_ENABLED is false on a deployment
-- without the trial code): with the switch on, checkout and the webhook need
-- them. Dropping the table forgets who already had a trial.
drop function if exists public.claim_redaxa_trial(text, uuid, text, text, timestamptz);
drop function if exists public.redaxa_trial_available(uuid, text);
drop table if exists public.redaxa_trial_claims;
