-- course_scoped_feedback_questions
-- Applied 20260809083411
-- Exported from the live project; do not edit by hand.

-- A question was attached to a period, and a period covers every course in
-- it. So there was no way to ask something about one subject only — a
-- coordinator's question about their own course would have gone to every
-- student on every course in the round.
--
-- course_id null keeps the old meaning (asked on every course in the period);
-- set means asked only on that one.
--
-- The old primary key was (feedback_period_id, question_id), and a primary key
-- cannot carry a nullable column, so uniqueness moves to an index declared
-- NULLS NOT DISTINCT — which still refuses the same period-wide question twice
-- — and the table gains a surrogate key of its own.

alter table public.feedback_period_questions
  add column if not exists course_id uuid references public.courses(id) on delete cascade;

alter table public.feedback_period_questions
  drop constraint if exists feedback_period_questions_pkey;

alter table public.feedback_period_questions
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.feedback_period_questions
  add constraint feedback_period_questions_pkey primary key (id);

drop index if exists public.feedback_period_questions_unique;
create unique index feedback_period_questions_unique
  on public.feedback_period_questions (feedback_period_id, question_id, course_id)
  nulls not distinct;

create index if not exists feedback_period_questions_course_idx
  on public.feedback_period_questions (course_id) where course_id is not null;

comment on column public.feedback_period_questions.course_id is
  'Null: asked on every course in the period. Set: asked only on that course — a coordinator''s question about their own subject.';
