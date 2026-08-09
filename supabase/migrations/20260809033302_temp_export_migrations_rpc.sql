-- temp_export_migrations_rpc
-- Applied 20260809033302
-- Exported from the live project; do not edit by hand.

-- One-off export helper. The schema history lives only in this project's
-- supabase_migrations table, which is not in the exposed API schema, so
-- there is otherwise no way to get it into the repository without the
-- database password or the Supabase CLI.
--
-- service_role only, and dropped again as soon as the export has run.
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
