-- fix_enrollment_period_stats_visibility
-- Applied 20260726092612
-- Exported from the live project; do not edit by hand.

-- The base table's own RLS (ep_read_published) already lets ANY admin read
-- ANY period regardless of department or draft status - periods aren't
-- department-owned for viewing purposes, only super_admin can create/edit
-- them. The department check just added to these two RPCs was stricter
-- than that and broke dept_admin's existing ability to view a period
-- belonging to another department or a faculty-wide (department IS NULL)
-- one - confirmed by reproducing it before this fix. Drop the check;
-- "must be an admin" is the only gate, matching the table itself.
CREATE OR REPLACE FUNCTION public.get_enrollment_period_summary(p_period_id uuid)
RETURNS TABLE (eligible_count integer, enrolled_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := get_my_role();
  v_batch integer;
  v_dept text;
  v_year text;
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT p.batch_year, p.department, p.academic_year
    INTO v_batch, v_dept, v_year
  FROM enrollment_periods p WHERE p.id = p_period_id;

  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'Enrollment period not found';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*)::int FROM students s
      WHERE s.role = 'student' AND s.batch_year = v_batch
        AND (v_dept IS NULL OR s.department = v_dept)),
    (SELECT count(DISTINCT e.student_id)::int FROM enrollments e
      JOIN students s ON s.id = e.student_id
      WHERE e.status = 'enrolled' AND e.academic_year = v_year
        AND s.batch_year = v_batch
        AND (v_dept IS NULL OR s.department = v_dept));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_enrollment_period_course_stats(p_period_id uuid)
RETURNS TABLE (
  course_id uuid,
  course_code text,
  course_title text,
  capacity integer,
  enrolled_count integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := get_my_role();
  v_batch integer;
  v_dept text;
  v_year text;
  v_semester integer;
  v_has_explicit boolean;
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT p.batch_year, p.department, p.academic_year, p.semester
    INTO v_batch, v_dept, v_year, v_semester
  FROM enrollment_periods p WHERE p.id = p_period_id;

  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'Enrollment period not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM enrollment_period_courses epc WHERE epc.period_id = p_period_id
  ) INTO v_has_explicit;

  RETURN QUERY
  SELECT c.id, c.course_code, c.title, epc.capacity,
    (SELECT count(DISTINCT e.student_id)::int FROM enrollments e
      JOIN students s ON s.id = e.student_id
      WHERE e.status = 'enrolled' AND e.academic_year = v_year
        AND e.course_id = c.id AND s.batch_year = v_batch
        AND (v_dept IS NULL OR s.department = v_dept))
  FROM courses c
  LEFT JOIN enrollment_period_courses epc
    ON epc.period_id = p_period_id AND epc.course_id = c.id
  WHERE
    CASE WHEN v_has_explicit
      THEN epc.id IS NOT NULL
      ELSE c.semester = v_semester AND (v_dept IS NULL OR c.department = v_dept)
    END
  ORDER BY c.course_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_enrollment_period_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_period_summary(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_enrollment_period_course_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_period_course_stats(uuid) TO authenticated, service_role;
