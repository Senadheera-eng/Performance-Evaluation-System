-- fix_search_handbook_public_grant
-- Applied 20260718205843
-- Exported from the live project; do not edit by hand.

-- Postgres grants EXECUTE to PUBLIC by default at function creation.
-- The earlier migration revoked from `anon` specifically but never revoked
-- the PUBLIC grant, so anon could still call it via that implicit grant.
revoke execute on function public.search_handbook(vector, int, float) from public;
grant execute on function public.search_handbook(vector, int, float) to authenticated;
