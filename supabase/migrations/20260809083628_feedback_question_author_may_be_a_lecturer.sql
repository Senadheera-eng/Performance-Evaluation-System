-- feedback_question_author_may_be_a_lecturer
-- Applied 20260809083628
-- Exported from the live project; do not edit by hand.

-- created_by pointed at `admins`, which a lecturer is not in, so a course
-- coordinator could not own a question they wrote. It has always held an auth
-- user id — admins.id is itself an auth.users FK — so repointing it loses
-- nothing and every existing row stays valid.
--
-- Same repair as feedback_periods.created_by when lecturers were first allowed
-- to raise a form.

alter table public.feedback_questions
  drop constraint if exists feedback_questions_created_by_fkey;

alter table public.feedback_questions
  add constraint feedback_questions_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
