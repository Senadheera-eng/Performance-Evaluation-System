-- add_course_enrollment_overview_rpcs
-- Applied 20260726110114
-- Exported from the live project; do not edit by hand.

-- Course-centric enrollment view for admins, independent of any single
-- enrolment period: for every course the admin owns, how many students are
-- currently enrolled and (if an open period happens to cap that course)
-- what the capacity is. Scoped by the COURSE's own department, the same
-- ownership model already used for results/attendance rosters — a
-- Computer Engineering admin manages CO-owned courses (which can still
-- have cross-department students, e.g. shared first-year courses), the IS
-- admin manages Interdisciplinary Studies-owned courses across every
-- department, and super_admin sees everything.
CREATE OR REPLACE FUNCTION public.get_admin_course_enrollment_overview()
RETURNS TABLE (
  course_id uuid,
  course_code text,
  course_title text,
  department text,
  semester integer,
  enrolled_count integer,
  capacity integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := get_my_role();
  v_dept text := get_my_department();
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.course_code, c.title, c.department, c.semester,
    (SELECT count(*)::int FROM enrollments e
      WHERE e.course_id = c.id AND e.status = 'enrolled'),
    (SELECT epc.capacity FROM enrollment_period_courses epc
      JOIN enrollment_periods p ON p.id = epc.period_id
      WHERE epc.course_id = c.id AND p.status = 'open'
      ORDER BY p.created_at DESC LIMIT 1)
  FROM courses c
  WHERE v_role = 'super_admin' OR c.department = v_dept
  ORDER BY c.semester, c.course_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_course_enrollment_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_course_enrollment_overview() TO authenticated, service_role;

-- Full enrolled-student roster for one course, department-ownership
-- checked the same way get_course_roster already does.
CREATE OR REPLACE FUNCTION public.get_course_enrolled_students(p_course_id uuid)
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
  ORDER BY s.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_enrolled_students(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_enrolled_students(uuid) TO authenticated, service_role;
