-- fix_is_admin_read_recursion
-- Applied 20260720055047
-- Exported from the live project; do not edit by hand.

-- The inline EXISTS subqueries in students_is_admin_read referenced
-- enrollments/courses/results directly inside the policy expression —
-- those queries run under the CALLING role's own RLS (not bypassed),
-- and evaluating that RLS calls get_my_role(), which queries students
-- again, re-triggering students' own policies (including this one) —
-- a genuine cycle, confirmed by reproducing it directly. Wrapping the
-- check in its own SECURITY DEFINER function gives it the same RLS
-- bypass get_my_role()/get_my_department() already rely on internally.
CREATE OR REPLACE FUNCTION public.student_has_is_course_link(p_student_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.student_id = p_student_id AND c.department = 'Interdisciplinary Studies'
  ) OR EXISTS (
    SELECT 1 FROM results r JOIN courses c ON c.id = r.course_id
    WHERE r.student_id = p_student_id AND c.department = 'Interdisciplinary Studies'
  );
END;
$function$;

DROP POLICY IF EXISTS students_is_admin_read ON students;
CREATE POLICY students_is_admin_read ON students
  FOR SELECT
  USING (
    get_my_role() = 'dept_admin'
    AND get_my_department() = 'Interdisciplinary Studies'
    AND student_has_is_course_link(students.id)
  );
