-- rate_limit_hit only revoked EXECUTE from PUBLIC. Supabase's default
-- privileges grant EXECUTE on new public functions to anon and authenticated
-- directly, so anyone holding the publishable key could call it and push a
-- known key (repo:global, or a sign-in limit) over its limit, locking those
-- checks for everyone. The API calls it with the service role only, like
-- every other RPC here. The counters table also gets RLS, as the others have.
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

alter table public.rate_limit_counters enable row level security;
