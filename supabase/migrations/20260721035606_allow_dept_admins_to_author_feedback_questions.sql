-- allow_dept_admins_to_author_feedback_questions
-- Applied 20260721035606
-- Exported from the live project; do not edit by hand.


ALTER TABLE public.feedback_questions ADD COLUMN created_by uuid NULL REFERENCES public.admins(id);

DROP POLICY IF EXISTS fq_super_admin_manage ON public.feedback_questions;

-- Any admin can add a custom question to the shared bank; only its creator
-- (or super_admin) can later edit/remove it. Questions with no creator are
-- the original seeded bank, editable by super_admin only.
CREATE POLICY fq_admin_insert ON public.feedback_questions
  FOR INSERT
  WITH CHECK (
    get_my_role() IN ('dept_admin','super_admin')
    AND created_by = auth.uid()
  );

CREATE POLICY fq_owner_or_super_admin_update ON public.feedback_questions
  FOR UPDATE
  USING (get_my_role() = 'super_admin' OR created_by = auth.uid())
  WITH CHECK (get_my_role() = 'super_admin' OR created_by = auth.uid());

CREATE POLICY fq_owner_or_super_admin_delete ON public.feedback_questions
  FOR DELETE
  USING (get_my_role() = 'super_admin' OR created_by = auth.uid());
