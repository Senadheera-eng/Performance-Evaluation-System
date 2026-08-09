-- scope_period_summary_header_by_admin_department
-- Applied 20260726140229
-- Exported from the live project; do not edit by hand.

-- The period card's top-level "X / Y enrolled" header
-- (get_enrollment_period_summary) had two bugs, both from the same root
-- causes already fixed on the per-course RPC but missed here:
--  1. Department scoping used the PERIOD's own department column (NULL
--     for this faculty-wide period), not the viewing admin's department -
--     showed 167 (faculty-wide) instead of the admin's own batch cohort.
--  2. enrolled_count trusted the period's own (decorative, unreliable)
--     academic_year field instead of deriving it per-course the same way
--     real student enrollments are tagged - showed 0 enrolled even though
--     real enrollments exist, because the period's stored "2021/2022"
--     never matches a real enrollment's derived "2024/2025".
-- Now joins through courses (needed to derive academic_year and to gate
-- by course visibility - own department + Interdisciplinary Studies,
-- honoring the period's explicit course list when set) and scopes both
-- counts to the viewer's own department for any non-super_admin.
CREATE OR REPLACE FUNCTION public.get_enrollment_period_summary(p_period_id uuid)
RETURNS TABLE(eligible_count integer, enrolled_count integer)
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
    (SELECT count(*)::int FROM students s
      WHERE s.role = 'student' AND s.batch_year = v_batch
        AND (v_period_dept IS NULL OR s.department = v_period_dept)
        AND (v_role = 'super_admin' OR s.department = v_admin_dept)
    ),
    (SELECT count(DISTINCT e.student_id)::int FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN courses c ON c.id = e.course_id
      WHERE e.status = 'enrolled'
        AND e.academic_year = (v_batch + ceil(c.semester / 2.0)::int - 1)::text
                               || '/' || (v_batch + ceil(c.semester / 2.0)::int)::text
        AND s.batch_year = v_batch
        AND (v_period_dept IS NULL OR s.department = v_period_dept)
        AND (v_role = 'super_admin' OR s.department = v_admin_dept)
        AND (
          v_role = 'super_admin'
          OR c.department = v_admin_dept
          OR c.department = 'Interdisciplinary Studies'
        )
        AND CASE WHEN v_has_explicit
          THEN EXISTS (
            SELECT 1 FROM enrollment_period_courses epc2
            WHERE epc2.period_id = p_period_id AND epc2.course_id = c.id
          )
          ELSE c.semester = v_semester
        END
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_enrollment_period_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_period_summary(uuid) TO authenticated, service_role;
