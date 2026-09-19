-- revoke_execute_on_new_trigger_functions
-- Applied 20260808105224
-- Exported from the live project; do not edit by hand.

-- Trigger functions are invoked by the trigger, never by a caller, but
-- PostgREST exposes every public function as an RPC endpoint and the default
-- grant is EXECUTE to PUBLIC. Left as-is, these four appear at
-- /rest/v1/rpc/<name> and are callable without signing in. The existing
-- schema already handles this for its own triggers (see
-- revoke_public_execute_on_security_definer_functions); this brings the new
-- ones in line.
revoke execute on function public.hod_appointment_department_matches() from public, anon, authenticated;
revoke execute on function public.prevent_lecturer_self_escalation()   from public, anon, authenticated;
revoke execute on function public.pin_course_identity_columns()        from public, anon, authenticated;
revoke execute on function public.block_course_delete_with_history()   from public, anon, authenticated;

-- The staff helpers are read by RLS policies, which evaluate as the querying
-- role, so `authenticated` genuinely needs EXECUTE on these. `anon` does not.
revoke execute on function public.my_lecturer_id()           from anon;
revoke execute on function public.is_active_hod_of(text)     from anon;
revoke execute on function public.my_hod_department()        from anon;
revoke execute on function public.offering_department(uuid)  from anon;
revoke execute on function public.is_assigned_lecturer(uuid) from anon;
revoke execute on function public.my_offering_ids()          from anon;
