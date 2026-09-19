-- add_department_to_course_roster
-- Applied 20260726090131
-- Exported from the live project; do not edit by hand.

-- Adds the student's home department, needed to group the result-sheet PDF
-- export by department for shared/IS courses. Purely additive, same as the
-- batch_year addition before it - existing callers unaffected.
DROP FUNCTION IF EXISTS public.get_course_roster(uuid, text);

CREATE FUNCTION public.get_course_roster(p_course_id uuid, p_academic_year text DEFAULT NULL::text)
RETURNS TABLE(student_id uuid, name text, reg_number text, index_number text, batch_year integer, department text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text := get_my_role();
  v_dept text := get_my_department();
  v_course_dept text;
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT c.department INTO v_course_dept FROM courses c WHERE c.id = p_course_id;
  IF v_role <> 'super_admin' AND v_course_dept IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'Access denied: course belongs to another department';
  END IF;

  RETURN QUERY
  SELECT DISTINCT s.id, s.name, s.reg_number, s.index_number, s.batch_year, s.department
  FROM students s
  WHERE s.role = 'student'
    AND (
      EXISTS (
        SELECT 1 FROM enrollments e
        WHERE e.student_id = s.id AND e.course_id = p_course_id
          AND e.status IN ('enrolled','completed')
          AND (p_academic_year IS NULL OR e.academic_year = p_academic_year)
      )
      OR EXISTS (
        SELECT 1 FROM results r
        WHERE r.student_id = s.id AND r.course_id = p_course_id
          AND (p_academic_year IS NULL OR r.academic_year = p_academic_year)
      )
    )
  ORDER BY s.name;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_course_roster(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_roster(uuid, text) TO authenticated, service_role;
