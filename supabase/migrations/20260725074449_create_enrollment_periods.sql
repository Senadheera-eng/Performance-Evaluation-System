-- create_enrollment_periods
-- Applied 20260725074449
-- Exported from the live project; do not edit by hand.


CREATE TABLE public.enrollment_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  academic_year text NOT NULL,
  semester int NOT NULL,
  batch_year int NOT NULL,
  department text NULL, -- NULL = all departments
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  created_by uuid NOT NULL REFERENCES public.admins(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at)
);

CREATE INDEX idx_enrollment_periods_batch ON public.enrollment_periods (batch_year);

ALTER TABLE public.enrollment_periods ENABLE ROW LEVEL SECURITY;

-- Students (and everyone) can see non-draft periods; only the super admin
-- manages them — enrolment windows are a faculty-level decision.
CREATE POLICY ep_read_published ON public.enrollment_periods
  FOR SELECT USING (status <> 'draft' OR get_my_role() IN ('dept_admin','super_admin'));

CREATE POLICY ep_super_admin_all ON public.enrollment_periods
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

-- Enforce the window server-side, not just in the UI: students can only
-- INSERT enrollment rows while a matching period is open. (The existing
-- student INSERT policies required only student_id = auth.uid().)
CREATE OR REPLACE FUNCTION public.enrollment_window_open_for_me()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM enrollment_periods p
    JOIN students s ON s.id = auth.uid()
    WHERE p.status = 'open'
      AND now() BETWEEN p.opens_at AND p.closes_at
      AND p.batch_year = s.batch_year
      AND (p.department IS NULL OR p.department = s.department)
  );
END;
$function$;

DROP POLICY IF EXISTS "Students can enroll themselves" ON public.enrollments;
DROP POLICY IF EXISTS enrollments_student_insert ON public.enrollments;

CREATE POLICY enrollments_student_insert ON public.enrollments
  FOR INSERT
  WITH CHECK (student_id = auth.uid() AND enrollment_window_open_for_me());
