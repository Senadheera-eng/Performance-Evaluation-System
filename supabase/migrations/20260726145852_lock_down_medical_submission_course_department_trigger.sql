-- lock_down_medical_submission_course_department_trigger
-- Applied 20260726145852
-- Exported from the live project; do not edit by hand.

-- Trigger functions should never be directly callable via the PostgREST
-- RPC surface (supabase.rpc(...)) - they only run implicitly on
-- INSERT/UPDATE. The advisor flagged this one as callable by anon.
REVOKE EXECUTE ON FUNCTION public.set_medical_submission_course_department() FROM PUBLIC, anon, authenticated;
