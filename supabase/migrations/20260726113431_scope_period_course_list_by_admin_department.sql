-- scope_period_course_list_by_admin_department
-- Applied 20260726113431
-- Exported from the live project; do not edit by hand.

-- The course list inside an expanded period was filtered by the PERIOD's
-- own department field, not the viewing admin's department. For a
-- faculty-wide period (department IS NULL, "All Departments"), that
-- condition is trivially true and every department's courses showed -
-- confirmed from a live screenshot: a Computer Engineering admin opening
-- "Semester 7 Enrollment" (department: All Departments) saw only Civil
-- Engineering courses at the top of an unfiltered, alphabetically-sorted
-- list spanning the whole faculty.
--
-- Scope is now always the ADMIN's own department (get_my_department()),
-- independent of whatever the period's own department field says, plus
-- Interdisciplinary Studies courses - shared/common courses every
-- department's students are eligible for. Applies to both the explicit
-- enrollment_period_courses path and the semester-based fallback, so
-- department scoping can't be bypassed by whichever path a given period
-- happens to use. super_admin remains unrestricted.
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
  v_eligible integer;
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

  -- Eligibility follows the PERIOD's own scope (who this window is open
  -- to), not the admin's - unchanged from before.
  SELECT count(*)::int INTO v_eligible FROM students s
    WHERE s.role = 'student' AND s.batch_year = v_batch
      AND (v_period_dept IS NULL OR s.department = v_period_dept);

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
        AND (v_period_dept IS NULL OR s.department = v_period_dept))
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

REVOKE EXECUTE ON FUNCTION public.get_enrollment_period_course_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_period_course_stats(uuid) TO authenticated, service_role;
