-- add_per_course_medical_review_schema
-- Applied 20260726145515
-- Exported from the live project; do not edit by hand.

-- Redesign the medical-certificate review workflow from a single
-- submission-level decision to a per-course decision. A submission can
-- cover courses from multiple departments (e.g. CO4203 + IS4161), and each
-- department must review only its own course(s), independent of the
-- others. The parent medical_submissions.status becomes a DERIVED value
-- computed from the course-level statuses rather than something a
-- department admin sets directly.

ALTER TABLE medical_submission_courses
  ADD COLUMN department text,
  ADD COLUMN review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN reviewed_by uuid REFERENCES admins(id),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_notes text;

-- Backfill department from the course's own department (authoritative at
-- backfill time); going forward a trigger stamps it at insert so it can
-- never be null or client-supplied.
UPDATE medical_submission_courses msc
SET department = c.department
FROM courses c
WHERE c.id = msc.course_id AND msc.department IS NULL;

ALTER TABLE medical_submission_courses
  ALTER COLUMN department SET NOT NULL,
  ADD CONSTRAINT medical_submission_courses_review_status_check
    CHECK (review_status IN ('pending', 'approved', 'rejected'));

CREATE OR REPLACE FUNCTION public.set_medical_submission_course_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  SELECT c.department INTO NEW.department FROM courses c WHERE c.id = NEW.course_id;
  IF NEW.department IS NULL THEN
    RAISE EXCEPTION 'Course not found for medical submission course link';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_medical_submission_course_department
  BEFORE INSERT ON medical_submission_courses
  FOR EACH ROW EXECUTE FUNCTION public.set_medical_submission_course_department();

-- The parent's overall status now spans 5 derived values instead of 3.
ALTER TABLE medical_submissions DROP CONSTRAINT medical_submissions_status_check;
ALTER TABLE medical_submissions ADD CONSTRAINT medical_submissions_status_check
  CHECK (status IN ('pending', 'partially_approved', 'approved', 'rejected', 'mixed'));

-- Audit trail: which submission (if any) caused an attendance row to be
-- auto-excused, so the change is traceable and not silently indistinguishable
-- from a manually-recorded excuse.
ALTER TABLE attendance
  ADD COLUMN excused_via_submission_id uuid REFERENCES medical_submissions(id) ON DELETE SET NULL;

-- Department admins previously updated the parent submission's status
-- directly (single-decision model). Review actions now go exclusively
-- through the review_medical_submission_course() RPC (SECURITY DEFINER),
-- which updates medical_submission_courses and recomputes the parent
-- status itself — a dept_admin has no business updating the parent row
-- directly any more, so this policy is removed rather than widened.
DROP POLICY IF EXISTS medical_submissions_dept_admin_update ON medical_submissions;
