-- permanent_service_role_migration_export_rpc
-- Applied 20260809074927
-- Exported from the live project; do not edit by hand.

-- The schema history lives in supabase_migrations, which is not an exposed
-- API schema, so keeping supabase/migrations in git means reading it through
-- a function. Creating and dropping that function around every export added
-- two rows to the very history it was exporting.
--
-- Kept permanently instead, reachable only by service_role — a key that never
-- reaches the browser. No signed-in user, anonymous or authenticated, can
-- call it.

create or replace function public.export_migrations()
returns table (version text, name text, statements text[])
language sql
stable security definer
set search_path to 'public'
as $$
  select m.version, m.name, m.statements
    from supabase_migrations.schema_migrations m
   order by m.version;
$$;

revoke execute on function public.export_migrations() from public, anon, authenticated;
grant  execute on function public.export_migrations() to service_role;
