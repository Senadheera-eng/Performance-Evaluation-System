-- fix_period_course_stats_academic_year_derivation
-- Applied 20260726112040
-- Exported from the live project; do not edit by hand.

-- The period's own academic_year column turns out to be decorative, not
-- authoritative: the student-facing enrollment flow (Enrollment.tsx,
-- semesterToAcademicYear) computes academic_year independently per course
-- as batch_year + ceil(course.semester/2) - 1, and never reads the
-- matched period's academic_year field at all. Verified directly - a real
-- enrollment row for a Batch 7 / Semester 7 course is tagged 2024/2025,
-- while the period that gated it stores "2021/2022". Filtering by
-- period.academic_year (what the previous version of this function did)
-- would silently show 0 enrolled for a course that genuinely has an
-- enrolled student. Derive the expected academic_year per course instead,
-- the same formula the real INSERT path already uses, so counts here
-- always match what's actually enrolled regardless of what an admin typed
-- into the period's own academic_year field.
DROP FUNCTION IF EXISTS public.get_enrollment_period_course_stats(uuid);
DROP FUNCTION IF EXISTS public.get_course_enrolled_students(uuid, text);

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
  v_semester integer;
  v_has_explicit boolean;
  v_eligible integer;
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT p.batch_year, p.department, p.semester
    INTO v_batch, v_dept, v_semester
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
      WHERE e.status = 'enrolled'
        AND e.academic_year = (v_batch + ceil(c.semester / 2.0)::int - 1)::text
                               || '/' || (v_batch + ceil(c.semester / 2.0)::int)::text
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

-- p_batch_year replaces p_academic_year: the caller no longer needs to know
-- (or guess) an academic_year string, just the batch whose enrolment this
-- roster belongs to - the function derives the correct year per-course
-- itself, the same formula as above.
CREATE FUNCTION public.get_course_enrolled_students(
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
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT c.department, c.semester INTO v_course_dept, v_course_semester
  FROM courses c WHERE c.id = p_course_id;
  IF v_course_dept IS NULL THEN
    RAISE EXCEPTION 'Course not found';
  END IF;
  IF v_role <> 'super_admin' AND v_course_dept IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'Access denied: course belongs to another department';
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
  ORDER BY s.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_enrolled_students(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_enrolled_students(uuid, integer) TO authenticated, service_role;
