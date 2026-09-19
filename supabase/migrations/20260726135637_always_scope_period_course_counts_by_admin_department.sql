-- always_scope_period_course_counts_by_admin_department
-- Applied 20260726135637
-- Exported from the live project; do not edit by hand.

-- Previous fix only scoped eligible/enrolled counts to the viewer's own
-- department for courses they DON'T own (IS/shared courses). For a course
-- the admin's own department owns (e.g. CO4002 for a CO admin), the OR
-- condition `c.department = v_admin_dept` made the whole student filter
-- trivially true, so eligible_count still counted the full faculty (167)
-- instead of just that department's batch cohort (41) - confirmed from a
-- live screenshot showing "1 of 167 enrolled" on CO-owned courses.
--
-- The rule is now unconditional for any non-super_admin: eligible/enrolled
-- counts are always restricted to the viewer's own department's students,
-- for every course row regardless of who owns the course (own-department
-- or shared IS). super_admin remains unrestricted (faculty-wide).
-- Same unconditional rule now applies to the roster RPC, replacing the
-- previous "only filter for non-owned/IS courses" branch.
CREATE OR REPLACE FUNCTION public.get_enrollment_period_course_stats(p_period_id uuid)
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
  v_admin_dept text := get_my_department();
  v_batch integer;
  v_period_dept text;
  v_semester integer;
  v_has_explicit boolean;
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT p.batch_year, p.department, p.semester
    INTO v_batch, v_period_dept, v_semester
  FROM enrollment_periods p WHERE p.id = p_period_id;

  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'Enrollment period not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM enrollment_period_courses epc WHERE epc.period_id = p_period_id
  ) INTO v_has_explicit;

  RETURN QUERY
  SELECT
    c.id, c.course_code, c.title, epc.capacity,
    (SELECT count(*)::int FROM students s
      WHERE s.role = 'student' AND s.batch_year = v_batch
        AND (v_period_dept IS NULL OR s.department = v_period_dept)
        AND (v_role = 'super_admin' OR s.department = v_admin_dept)
    ) AS eligible_count,
    (SELECT count(DISTINCT e.student_id)::int FROM enrollments e
      JOIN students s ON s.id = e.student_id
      WHERE e.status = 'enrolled'
        AND e.academic_year = (v_batch + ceil(c.semester / 2.0)::int - 1)::text
                               || '/' || (v_batch + ceil(c.semester / 2.0)::int)::text
        AND e.course_id = c.id AND s.batch_year = v_batch
        AND (v_period_dept IS NULL OR s.department = v_period_dept)
        AND (v_role = 'super_admin' OR s.department = v_admin_dept)
    ) AS enrolled_count
  FROM courses c
  LEFT JOIN enrollment_period_courses epc
    ON epc.period_id = p_period_id AND epc.course_id = c.id
  WHERE
    (
      v_role = 'super_admin'
      OR c.department = v_admin_dept
      OR c.department = 'Interdisciplinary Studies'
    )
    AND CASE WHEN v_has_explicit
      THEN epc.id IS NOT NULL
      ELSE c.semester = v_semester
    END
  ORDER BY c.course_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_course_enrolled_students(
  p_course_id uuid,
  p_batch_year integer DEFAULT NULL
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
  v_course_semester integer;
  v_expected_year text;
  v_student_dept_filter text;
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT c.department, c.semester INTO v_course_dept, v_course_semester
  FROM courses c WHERE c.id = p_course_id;
  IF v_course_dept IS NULL THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  IF v_role <> 'super_admin' THEN
    IF v_course_dept IS DISTINCT FROM v_dept AND v_course_dept <> 'Interdisciplinary Studies' THEN
      RAISE EXCEPTION 'Access denied: course belongs to another department';
    END IF;
    v_student_dept_filter := v_dept;
  END IF;

  IF p_batch_year IS NOT NULL THEN
    v_expected_year := (p_batch_year + ceil(v_course_semester / 2.0)::int - 1)::text
                        || '/' || (p_batch_year + ceil(v_course_semester / 2.0)::int)::text;
  END IF;

  RETURN QUERY
  SELECT s.id, s.name, s.index_number, s.reg_number, s.batch_year,
         s.department, e.status, e.enrolled_at
  FROM enrollments e
  JOIN students s ON s.id = e.student_id
  WHERE e.course_id = p_course_id AND e.status = 'enrolled'
    AND (v_expected_year IS NULL OR e.academic_year = v_expected_year)
    AND (v_student_dept_filter IS NULL OR s.department = v_student_dept_filter)
  ORDER BY s.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_enrollment_period_course_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_period_course_stats(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_course_enrolled_students(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_enrolled_students(uuid, integer) TO authenticated, service_role;
