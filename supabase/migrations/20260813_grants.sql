-- Fixes checkout being broken for every account since launch: the billing
-- migration revoked EXECUTE on these RPC functions from public/anon/
-- authenticated (correctly, since they must not be callable from the
-- browser) but never explicitly granted it to service_role. Unlike table
-- RLS, which service_role bypasses automatically, function EXECUTE grants
-- are a separate permission that service_role does NOT get for free -- so
-- every call from the backend (which always uses the service key) failed
-- with "permission denied for function reserve_billing_checkout" (Postgres
-- error 42501). Found by attempting a real checkout and reading the actual
-- RPC error instead of the generic 500 the API had been swallowing.
grant execute on function public.reserve_billing_checkout(uuid) to service_role;
grant execute on function public.claim_stripe_event(text, text) to service_role;
grant execute on function public.complete_stripe_event(text) to service_role;
