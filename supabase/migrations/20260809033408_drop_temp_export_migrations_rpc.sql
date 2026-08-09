-- drop_temp_export_migrations_rpc
-- Applied 20260809033408
-- Exported from the live project; do not edit by hand.

-- The export has run and the history is now in supabase/migrations/. A
-- function whose only purpose is to dump the schema history does not need to
-- stay reachable, even to service_role.
drop function if exists public.export_migrations();
