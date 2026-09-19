-- harden_function_grants_and_search_paths
-- Applied 20260725074917
-- Exported from the live project; do not edit by hand.


-- Advisor: anon (logged-out) could invoke every public RPC. All of them
-- fail safely on auth.uid()/role checks, but there is no reason for
-- unauthenticated callers to reach them at all.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn.sig);
  END LOOP;
END $$;

-- Trigger functions are invoked by the trigger mechanism, never directly.
REVOKE EXECUTE ON FUNCTION public.prevent_self_privilege_escalation() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_feedback_period_transition() FROM authenticated;

-- Advisor: pin search_path on the remaining functions that lacked it.
ALTER FUNCTION public.get_courses_by_semester(int) SET search_path = public;
ALTER FUNCTION public.get_upcoming_courses() SET search_path = public;
ALTER FUNCTION public.calculate_gpa_target(numeric) SET search_path = public;
ALTER FUNCTION public.validate_feedback_period_transition() SET search_path = public;
