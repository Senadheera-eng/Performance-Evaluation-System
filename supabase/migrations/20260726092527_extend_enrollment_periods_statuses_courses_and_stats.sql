-- extend_enrollment_periods_statuses_courses_and_stats
-- Applied 20260726092527
-- Exported from the live project; do not edit by hand.

-- Widen status: draft (being configured, hidden from students - matches
-- ep_read_published's existing "status <> 'draft'" rule with no RLS change
-- needed) / scheduled (visible, upcoming, not yet manually opened) / open /
-- closed / archived. Opening remains a manual admin action either way -
-- enrollment_window_open_for_me() only ever matched status='open', so a
-- scheduled period could never let a student enrol even past its opens_at,
-- exactly as before.
ALTER TABLE public.enrollment_periods
  DROP CONSTRAINT enrollment_periods_status_check,
  ADD CONSTRAINT enrollment_periods_status_check
    CHECK (status = ANY (ARRAY['draft','scheduled','open','closed','archived']));

ALTER TABLE public.enrollment_periods
  ADD COLUMN IF NOT EXISTS instructions text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_enrollment_period_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrollment_periods_updated_at ON public.enrollment_periods;
CREATE TRIGGER trg_enrollment_periods_updated_at
  BEFORE UPDATE ON public.enrollment_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.set_enrollment_period_updated_at();

REVOKE EXECUTE ON FUNCTION public.set_enrollment_period_updated_at() FROM PUBLIC, anon;

-- Informational only, deliberately: student enrolment eligibility keeps
-- working exactly as it does today, gated purely by
-- enrollment_window_open_for_me() (batch + department + time window).
-- There is a currently OPEN, live period ("Semester 7 Enrollment") with no
-- course rows - if this table were made a hard enrolment gate, every
-- student in that window would be locked out the moment this migration
-- ran. Capacity/per-course counts are reporting only.
CREATE TABLE public.enrollment_period_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.enrollment_periods(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  capacity integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, course_id)
);

ALTER TABLE public.enrollment_period_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY epc_read_with_period ON public.enrollment_period_courses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM enrollment_periods p
      WHERE p.id = enrollment_period_courses.period_id
        AND (p.status <> 'draft' OR get_my_role() IN ('dept_admin','super_admin'))
    )
  );

CREATE POLICY epc_super_admin_all ON public.enrollment_period_courses
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

-- Eligible/enrolled counts, correct regardless of caller's own department -
-- the existing frontend computed this via a direct join to `students`,
-- which silently undercounts for any admin who isn't super_admin (students
-- RLS is department-scoped, and a period can span every department).
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

  IF v_role <> 'super_admin' AND v_dept IS DISTINCT FROM get_my_department() THEN
    RAISE EXCEPTION 'Access denied: period belongs to another department';
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

REVOKE EXECUTE ON FUNCTION public.get_enrollment_period_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_period_summary(uuid) TO authenticated, service_role;

-- Per-course breakdown: explicit enrollment_period_courses rows when the
-- admin has listed them, otherwise every course matching the period's
-- semester (+ department, when set) as a reasonable default so existing
-- periods with no course rows still show something useful.
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

  IF v_role <> 'super_admin' AND v_dept IS DISTINCT FROM get_my_department() THEN
    RAISE EXCEPTION 'Access denied: period belongs to another department';
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

REVOKE EXECUTE ON FUNCTION public.get_enrollment_period_course_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_period_course_stats(uuid) TO authenticated, service_role;
