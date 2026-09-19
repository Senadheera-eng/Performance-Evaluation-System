-- remove_student_self_registration
-- Applied 20260725084328
-- Exported from the live project; do not edit by hand.


-- Student accounts are provisioned by administrators; students never
-- self-register. The students_self_insert policy allowed any signed-in
-- user to create their own students row (role='student'), which meant a
-- self-signup via the public anon key could mint a student profile.
-- Admins retain INSERT through students_dept_admin_own_department and
-- students_super_admin_all, so provisioning is unaffected.
DROP POLICY IF EXISTS students_self_insert ON public.students;
