-- add_course_results_roster_rpc
-- Applied 20260725074120
-- Exported from the live project; do not edit by hand.


-- Roster for results/attendance entry. A dept admin owns the COURSE, so
-- they may see name/reg of every student taking it — including students
-- homed in other departments — but only for courses in their own
-- department. Includes students who have a result row but no enrollment
-- row (historical imports).
CREATE OR REPLACE FUNCTION public.get_course_roster(p_course_id uuid, p_academic_year text DEFAULT NULL)
RETURNS TABLE (
  student_id uuid, name text, reg_number text, index_number text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
  SELECT DISTINCT s.id, s.name, s.reg_number, s.index_number
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

GRANT EXECUTE ON FUNCTION public.get_course_roster(uuid, text) TO authenticated;
