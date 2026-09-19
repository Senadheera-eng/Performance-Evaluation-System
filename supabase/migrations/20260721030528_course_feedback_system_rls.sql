-- course_feedback_system_rls
-- Applied 20260721030528
-- Exported from the live project; do not edit by hand.


ALTER TABLE public.feedback_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_period_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_period_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_answers ENABLE ROW LEVEL SECURITY;

-- feedback_periods: published periods are readable by everyone (students
-- need to see them); dept admins manage (including their own drafts) only
-- periods owned by their department; super_admin manages everything,
-- including faculty-wide (department IS NULL) periods.
CREATE POLICY fp_read_published ON public.feedback_periods
  FOR SELECT USING (status <> 'draft');

CREATE POLICY fp_dept_admin_manage ON public.feedback_periods
  FOR ALL
  USING (get_my_role() = 'dept_admin' AND department = get_my_department())
  WITH CHECK (get_my_role() = 'dept_admin' AND department = get_my_department());

CREATE POLICY fp_super_admin_all ON public.feedback_periods
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

-- feedback_questions: the master question bank is readable by everyone
-- (students need question text) but only super_admin curates it, per spec
-- ("so that the Super Admin can modify future questionnaires").
CREATE POLICY fq_read ON public.feedback_questions
  FOR SELECT USING (is_active = true OR get_my_role() IN ('dept_admin','super_admin'));

CREATE POLICY fq_super_admin_manage ON public.feedback_questions
  FOR ALL
  USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

-- feedback_period_questions: readable by everyone; a period's owner
-- (dept_admin for their own department's periods, or super_admin for any)
-- picks which existing questions apply to it.
CREATE POLICY fpq_read ON public.feedback_period_questions
  FOR SELECT USING (true);

CREATE POLICY fpq_owner_manage ON public.feedback_period_questions
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM feedback_periods p WHERE p.id = feedback_period_questions.feedback_period_id
      AND (get_my_role() = 'super_admin' OR (get_my_role() = 'dept_admin' AND p.department = get_my_department()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM feedback_periods p WHERE p.id = feedback_period_questions.feedback_period_id
      AND (get_my_role() = 'super_admin' OR (get_my_role() = 'dept_admin' AND p.department = get_my_department()))
  ));

-- feedback_period_courses: readable by everyone (students need eligible
-- course lists); a period's owner can only attach courses that belong to
-- their own department (super_admin can attach any course to any period).
CREATE POLICY fpc_read ON public.feedback_period_courses
  FOR SELECT USING (true);

CREATE POLICY fpc_owner_manage ON public.feedback_period_courses
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM feedback_periods p JOIN courses c ON c.id = feedback_period_courses.course_id
    WHERE p.id = feedback_period_courses.feedback_period_id
      AND (get_my_role() = 'super_admin' OR (get_my_role() = 'dept_admin' AND p.department = get_my_department() AND c.department = get_my_department()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM feedback_periods p JOIN courses c ON c.id = feedback_period_courses.course_id
    WHERE p.id = feedback_period_courses.feedback_period_id
      AND (get_my_role() = 'super_admin' OR (get_my_role() = 'dept_admin' AND p.department = get_my_department() AND c.department = get_my_department()))
  ));

-- feedback_submissions / feedback_answers: students only, full stop. No
-- admin SELECT policy exists on these base tables at all — admin access is
-- exclusively through SECURITY DEFINER RPCs below that mask identity for
-- anonymous rows. This is stronger than RLS-scoped admin access with
-- client-side masking, since there is no direct path to the raw identity
-- column for an admin session under any query shape.
CREATE POLICY fs_student_select ON public.feedback_submissions
  FOR SELECT USING (student_id = auth.uid());
CREATE POLICY fs_student_insert ON public.feedback_submissions
  FOR INSERT WITH CHECK (student_id = auth.uid());
CREATE POLICY fs_student_update ON public.feedback_submissions
  FOR UPDATE USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE OR REPLACE FUNCTION public.submission_belongs_to_me_fb(p_submission_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM feedback_submissions fs
    WHERE fs.id = p_submission_id AND fs.student_id = auth.uid()
  );
END;
$function$;

CREATE POLICY fa_student_select ON public.feedback_answers
  FOR SELECT USING (submission_belongs_to_me_fb(submission_id));
CREATE POLICY fa_student_insert ON public.feedback_answers
  FOR INSERT WITH CHECK (submission_belongs_to_me_fb(submission_id));
CREATE POLICY fa_student_update ON public.feedback_answers
  FOR UPDATE USING (submission_belongs_to_me_fb(submission_id)) WITH CHECK (submission_belongs_to_me_fb(submission_id));
CREATE POLICY fa_student_delete ON public.feedback_answers
  FOR DELETE USING (submission_belongs_to_me_fb(submission_id));
