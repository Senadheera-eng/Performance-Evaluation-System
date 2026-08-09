-- dept_scope_results_attendance_enrollments_medical_rls
-- Applied 20260720045606
-- Exported from the live project; do not edit by hand.

-- Scope by the COURSE's department (via EXISTS/subquery join to courses),
-- not the student's home department. This is what makes IS-course records
-- belong to the IS admin even when the enrolled student's home department
-- is e.g. Mechanical Engineering: a Mechanical admin's policy only matches
-- rows whose course.department = 'Mechanical Engineering', so an IS course
-- row never satisfies it even though the student is on their roster. The
-- IS admin's own department value ('Interdisciplinary Studies') equals
-- courses.department for IS courses directly, so this is one uniform
-- policy shape for all 5 department admins — no special-casing needed,
-- same pattern as the courses table policy.
-- medical_submissions is included here (not a separate table) since it
-- also has course_id and needs the identical course-department scoping —
-- the original plan assumed a differently-shaped 'medical_certificates'
-- table that doesn't exist; the real table is medical_submissions.

DROP POLICY IF EXISTS results_admin_all ON results;
DROP POLICY IF EXISTS attendance_admin_all ON attendance;
DROP POLICY IF EXISTS enrollments_admin_all ON enrollments;
DROP POLICY IF EXISTS medical_admin_all ON medical_submissions;

CREATE POLICY results_super_admin_all ON results
  FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY results_dept_admin_own_courses ON results
  FOR ALL
  USING (get_my_role() = 'dept_admin' AND get_my_department() = (SELECT c.department FROM courses c WHERE c.id = results.course_id))
  WITH CHECK (get_my_role() = 'dept_admin' AND get_my_department() = (SELECT c.department FROM courses c WHERE c.id = results.course_id));

CREATE POLICY attendance_super_admin_all ON attendance
  FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY attendance_dept_admin_own_courses ON attendance
  FOR ALL
  USING (get_my_role() = 'dept_admin' AND get_my_department() = (SELECT c.department FROM courses c WHERE c.id = attendance.course_id))
  WITH CHECK (get_my_role() = 'dept_admin' AND get_my_department() = (SELECT c.department FROM courses c WHERE c.id = attendance.course_id));

CREATE POLICY enrollments_super_admin_all ON enrollments
  FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY enrollments_dept_admin_own_courses ON enrollments
  FOR ALL
  USING (get_my_role() = 'dept_admin' AND get_my_department() = (SELECT c.department FROM courses c WHERE c.id = enrollments.course_id))
  WITH CHECK (get_my_role() = 'dept_admin' AND get_my_department() = (SELECT c.department FROM courses c WHERE c.id = enrollments.course_id));

CREATE POLICY medical_super_admin_all ON medical_submissions
  FOR ALL USING (get_my_role() = 'super_admin') WITH CHECK (get_my_role() = 'super_admin');
CREATE POLICY medical_dept_admin_own_courses ON medical_submissions
  FOR ALL
  USING (get_my_role() = 'dept_admin' AND get_my_department() = (SELECT c.department FROM courses c WHERE c.id = medical_submissions.course_id))
  WITH CHECK (get_my_role() = 'dept_admin' AND get_my_department() = (SELECT c.department FROM courses c WHERE c.id = medical_submissions.course_id));
