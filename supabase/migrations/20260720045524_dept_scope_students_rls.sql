-- dept_scope_students_rls
-- Applied 20260720045524
-- Exported from the live project; do not edit by hand.

-- Replace the flat blanket-admin policy, plus two pre-existing over-broad
-- policies discovered while auditing this table: students_select allowed
-- ANY logged-in student to read every other student's full profile, and
-- students_update allowed any logged-in student to update ANY row
-- (including its own role/status/department — a privilege-escalation
-- path). students_own_read already correctly scopes SELECT to id =
-- auth.uid(), so students_select was pure redundant over-grant. Also
-- tightening students_insert, which had no restriction at all (not used
-- by any live registration flow in the app today).

DROP POLICY IF EXISTS students_admin_all ON students;
DROP POLICY IF EXISTS students_select ON students;
DROP POLICY IF EXISTS students_update ON students;
DROP POLICY IF EXISTS students_insert ON students;

CREATE POLICY students_self_update ON students
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY students_self_insert ON students
  FOR INSERT
  WITH CHECK (id = auth.uid() AND role = 'student');

CREATE POLICY students_super_admin_all ON students
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

-- Regular department admin: full CRUD, but only within their own department.
CREATE POLICY students_dept_admin_own_department ON students
  FOR ALL
  USING (get_my_role() = 'dept_admin' AND get_my_department() = department)
  WITH CHECK (get_my_role() = 'dept_admin' AND get_my_department() = department);

-- IS admin: no student belongs to IS as a home department, so instead of a
-- roster they get read-only visibility into students who have at least one
-- enrollment or result in an IS course — enough to manage IS course data,
-- never full ownership of the student's profile (that stays with the
-- student's real department admin or Super Admin).
CREATE POLICY students_is_admin_read ON students
  FOR SELECT
  USING (
    get_my_role() = 'dept_admin'
    AND get_my_department() = 'Interdisciplinary Studies'
    AND (
      EXISTS (
        SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id
        WHERE e.student_id = students.id AND c.department = 'Interdisciplinary Studies'
      )
      OR EXISTS (
        SELECT 1 FROM results r JOIN courses c ON c.id = r.course_id
        WHERE r.student_id = students.id AND c.department = 'Interdisciplinary Studies'
      )
    )
  );

-- Belt-and-suspenders against self-privilege-escalation: even if a future
-- policy change accidentally widens students_self_update, a student can
-- never change their own role/status/department via any UPDATE path where
-- they are the row owner. Admin-driven updates on OTHER students' rows are
-- unaffected (auth.uid() there is the admin's own id, not the row's id).
CREATE OR REPLACE FUNCTION public.prevent_self_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() = OLD.id THEN
    NEW.role := OLD.role;
    NEW.status := OLD.status;
    NEW.department := OLD.department;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_self_privilege_escalation ON students;
CREATE TRIGGER trg_prevent_self_privilege_escalation
  BEFORE UPDATE ON students
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_privilege_escalation();
