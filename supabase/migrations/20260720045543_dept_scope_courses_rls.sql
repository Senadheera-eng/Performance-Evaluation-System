-- dept_scope_courses_rls
-- Applied 20260720045543
-- Exported from the live project; do not edit by hand.

-- Unlike students, courses.department DOES include 'Interdisciplinary
-- Studies' as a real value, so a single equality-based policy correctly
-- covers all 5 department admins (the 4 regular ones and the IS admin)
-- without needing a special case. Public read-only visibility is
-- untouched — students still need to browse the full catalogue to enroll
-- in electives.
DROP POLICY IF EXISTS courses_admin_all ON courses;

CREATE POLICY courses_super_admin_all ON courses
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

CREATE POLICY courses_dept_admin_own_department ON courses
  FOR ALL
  USING (get_my_role() = 'dept_admin' AND get_my_department() = department)
  WITH CHECK (get_my_role() = 'dept_admin' AND get_my_department() = department);
