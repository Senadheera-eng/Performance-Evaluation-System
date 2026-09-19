-- nest_course_stats_under_period_and_scope_roster_by_period
-- Applied 20260726111824
-- Exported from the live project; do not edit by hand.

DROP FUNCTION IF EXISTS public.get_enrollment_period_course_stats(uuid);
DROP FUNCTION IF EXISTS public.get_course_enrolled_students(uuid);

CREATE FUNCTION public.get_enrollment_period_course_stats(p_period_id uuid)
RETURNS TABLE (
  course_id uuid,
  course_code text,
  course_title text,
  capacity integer,
  eligible_count integer,
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
  v_eligible integer;
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

  SELECT count(*)::int INTO v_eligible FROM students s
    WHERE s.role = 'student' AND s.batch_year = v_batch
      AND (v_dept IS NULL OR s.department = v_dept);

  SELECT EXISTS (
    SELECT 1 FROM enrollment_period_courses epc WHERE epc.period_id = p_period_id
  ) INTO v_has_explicit;

  RETURN QUERY
  SELECT c.id, c.course_code, c.title, epc.capacity, v_eligible,
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

REVOKE EXECUTE ON FUNCTION public.get_enrollment_period_course_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_period_course_stats(uuid) TO authenticated, service_role;

CREATE FUNCTION public.get_course_enrolled_students(
  p_course_id uuid,
  p_academic_year text DEFAULT NULL
)
RETURNS TABLE (
  student_id uuid,
  name text,
  index_number text,
  reg_number text,
  batch_year integer,
  department text,
  status text,
  enrolled_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := get_my_role();
  v_dept text := get_my_department();
  v_course_dept text;
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT c.department INTO v_course_dept FROM courses c WHERE c.id = p_course_id;
  IF v_course_dept IS NULL THEN
    RAISE EXCEPTION 'Course not found';
  END IF;
  IF v_role <> 'super_admin' AND v_course_dept IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'Access denied: course belongs to another department';
  END IF;

  RETURN QUERY
  SELECT s.id, s.name, s.index_number, s.reg_number, s.batch_year,
         s.department, e.status, e.enrolled_at
  FROM enrollments e
  JOIN students s ON s.id = e.student_id
  WHERE e.course_id = p_course_id AND e.status = 'enrolled'
    AND (p_academic_year IS NULL OR e.academic_year = p_academic_year)
  ORDER BY s.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_enrolled_students(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_enrolled_students(uuid, text) TO authenticated, service_role;
