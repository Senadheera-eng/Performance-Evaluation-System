-- revoke_public_execute_on_security_definer_functions
-- Applied 20260725075824
-- Exported from the live project; do not edit by hand.


-- Postgres grants EXECUTE to PUBLIC on every new function, and `anon` is a
-- member of PUBLIC — so the previous "REVOKE ... FROM anon" was a no-op
-- (the ACL still read `=X/postgres`, i.e. PUBLIC holds EXECUTE).
-- Revoke from PUBLIC itself and re-grant explicitly to the roles that need
-- it. Scoped to SECURITY DEFINER functions: those bypass RLS, so they are
-- the ones that actually matter for an unauthenticated caller.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig,
           p.prorettype = 'trigger'::regtype AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn.sig);
    -- Trigger functions are invoked by the trigger mechanism, never called
    -- directly, so they get no role grant at all.
    IF NOT fn.is_trigger THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.sig);
    END IF;
  END LOOP;
END $$;
