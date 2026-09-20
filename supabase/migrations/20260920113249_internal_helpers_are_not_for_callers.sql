-- Internal helpers stop being callable by whoever is signed in.
--
-- These answer a question for another function — who is on this offering,
-- who administers this department, which delivery is this student's — and
-- they run as their owner, so anyone signed in could call them directly and
-- get an answer the calling screen would never have given them. A student
-- could list the user ids of everyone in a class, or of a department's
-- administrators. Nothing worse than ids, and every table they might be
-- used against has its own row security, but there is no reason to hand
-- them out.
--
-- Checked before revoking: none of these appears in a row-security policy
-- (a policy is evaluated as the caller, so revoking one used there would
-- lock people out of their own rows), no SECURITY INVOKER function calls
-- them, and the application never calls them. The SECURITY DEFINER
-- functions that use them are owned by the same role and so are unaffected.
revoke execute on function public.offering_student_ids(uuid) from public, anon, authenticated;
revoke execute on function public.offering_lecturer_ids(uuid) from public, anon, authenticated;
revoke execute on function public.department_admin_ids(text) from public, anon, authenticated;
revoke execute on function public.department_head_id(text) from public, anon, authenticated;
revoke execute on function public.department_owns_student(text, uuid) from public, anon, authenticated;
revoke execute on function public.offering_label(uuid) from public, anon, authenticated;
revoke execute on function public.period_covers_course(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.offering_student_count(uuid) from public, anon, authenticated;
revoke execute on function public.offering_for_student_course(uuid, uuid) from public, anon, authenticated;