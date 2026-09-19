-- fix_feedback_eligibility_include_historical_results
-- Applied 20260725092454
-- Exported from the live project; do not edit by hand.


-- ROOT CAUSE
-- Every student-facing feedback function decided eligibility with an INNER
-- JOIN on `enrollments`. Historical semesters were bulk-imported straight
-- into `results` with no matching enrollment rows, so for any completed
-- semester the join produced zero rows: the student saw "No courses found",
-- and had the list been populated, submission would have failed too since
-- save/submit applied the same test.
--
-- A student has taken a course if they have an enrollment row for it OR a
-- result row for it. That single rule now lives in one function used by
-- every entry point, so the list, the form and the write path can no longer
-- disagree with each other.
CREATE OR REPLACE FUNCTION public.student_took_course(
  p_student_id uuid, p_course_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM enrollments e
    WHERE e.student_id = p_student_id AND e.course_id = p_course_id
      AND e.status IN ('enrolled', 'completed')
  ) OR EXISTS (
    SELECT 1 FROM results r
    WHERE r.student_id = p_student_id AND r.course_id = p_course_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.student_eligible_for_feedback(
  p_student_id uuid, p_period_id uuid, p_course_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_period record;
  v_batch int;
BEGIN
  SELECT * INTO v_period FROM feedback_periods WHERE id = p_period_id;
  IF v_period IS NULL THEN RETURN false; END IF;

  -- Course must belong to this period.
  IF NOT EXISTS (
    SELECT 1 FROM feedback_period_courses fpc
    WHERE fpc.feedback_period_id = p_period_id AND fpc.course_id = p_course_id
  ) THEN RETURN false; END IF;

  -- Period must target this student's batch (NULL = all batches).
  SELECT batch_year INTO v_batch FROM students WHERE id = p_student_id;
  IF v_period.batch_year IS NOT NULL AND v_period.batch_year IS DISTINCT FROM v_batch THEN
    RETURN false;
  END IF;

  RETURN student_took_course(p_student_id, p_course_id);
END;
$function$;

-- Active periods: a period is relevant when it is open, in-window, targets
-- the student's batch, and contains at least one course the student
-- actually took. The course test replaces the previous department check —
-- it is stricter (it can't surface a period with nothing to answer) and it
-- still works for Interdisciplinary Studies periods, whose courses are
-- taken by students of every department.
CREATE OR REPLACE FUNCTION public.get_student_active_feedback_period()
RETURNS TABLE (
  id uuid, title text, academic_year text, semester int, batch_year int,
  opens_at timestamptz, closes_at timestamptz, status text, allow_editing boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid := auth.uid();
BEGIN
  RETURN QUERY
  SELECT p.id, p.title, p.academic_year, p.semester, p.batch_year,
         p.opens_at, p.closes_at, p.status, p.allow_editing
  FROM feedback_periods p
  JOIN students s ON s.id = v_student_id
  WHERE p.status = 'open'
    AND now() BETWEEN p.opens_at AND p.closes_at
    AND (p.batch_year IS NULL OR p.batch_year = s.batch_year)
    AND EXISTS (
      SELECT 1 FROM feedback_period_courses fpc
      WHERE fpc.feedback_period_id = p.id
        AND student_took_course(v_student_id, fpc.course_id)
    )
  ORDER BY p.closes_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_student_eligible_feedback_courses(p_period_id uuid)
RETURNS TABLE (
  course_id uuid, course_code text, title text, credits int, semester int,
  category text, department text, lecturer_name text, submission_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid := auth.uid();
  v_period record;
  v_open boolean;
BEGIN
  SELECT * INTO v_period FROM feedback_periods WHERE id = p_period_id;
  IF v_period IS NULL THEN RETURN; END IF;

  v_open := v_period.status = 'open'
            AND now() BETWEEN v_period.opens_at AND v_period.closes_at;

  RETURN QUERY
  SELECT c.id, c.course_code, c.title, c.credits, c.semester, c.category,
         c.department, c.lecturer_name,
         CASE
           WHEN fs.status = 'submitted' THEN 'submitted'
           WHEN fs.status = 'draft' AND v_open THEN 'draft'
           WHEN fs.status = 'draft' THEN 'closed'
           WHEN v_open THEN 'pending'
           ELSE 'closed'
         END AS submission_status
  FROM feedback_period_courses fpc
  JOIN courses c ON c.id = fpc.course_id
  LEFT JOIN feedback_submissions fs
         ON fs.feedback_period_id = p_period_id
        AND fs.course_id = c.id
        AND fs.student_id = v_student_id
  WHERE fpc.feedback_period_id = p_period_id
    AND student_took_course(v_student_id, c.id)
  ORDER BY c.course_code;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.student_took_course(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.student_eligible_for_feedback(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_student_active_feedback_period() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_student_eligible_feedback_courses(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_took_course(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_eligible_for_feedback(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_active_feedback_period() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_eligible_feedback_courses(uuid) TO authenticated, service_role;
