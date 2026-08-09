-- feedback_question_model_extension
-- Applied 20260808203957
-- Exported from the live project; do not edit by hand.

-- Extends the feedback question model to cover what the faculty's own form
-- actually asks, and to let a question be aimed at a specific lecturer
-- rather than at the course as a whole.
--
-- The existing engine only knows rating / short_text / long_text. The
-- faculty form also has single-choice questions with named options (delivery
-- mode, effectiveness, teaching approach) and yes/no gates that reveal a
-- whole section (Continuous Assessments, Field Visits). None of those could
-- be expressed at all.
--
-- Additive throughout: every existing question keeps working unchanged,
-- because target_type defaults to 'course' and the new columns are nullable.

-- ---------------------------------------------------------------------
-- Questions
-- ---------------------------------------------------------------------
alter table public.feedback_questions
  add column if not exists options              jsonb,
  add column if not exists target_type          text not null default 'course',
  add column if not exists section_key          text,
  add column if not exists section_title        text,
  add column if not exists section_order        integer not null default 0,
  add column if not exists depends_on_question_id uuid references public.feedback_questions(id) on delete set null,
  add column if not exists depends_on_values    jsonb;

alter table public.feedback_questions drop constraint if exists feedback_questions_question_type_check;
alter table public.feedback_questions
  add constraint feedback_questions_question_type_check
  check (question_type in ('rating', 'short_text', 'long_text', 'single_choice', 'yes_no'));

alter table public.feedback_questions drop constraint if exists feedback_questions_target_type_check;
alter table public.feedback_questions
  add constraint feedback_questions_target_type_check
  check (target_type in ('course', 'lecturer'));

-- A single-choice question without options is unanswerable, and a
-- non-choice question with options is a modelling mistake. Both are worth
-- catching at write time rather than discovering on a live form.
alter table public.feedback_questions drop constraint if exists feedback_questions_options_shape;
alter table public.feedback_questions
  add constraint feedback_questions_options_shape check (
    (question_type = 'single_choice' and jsonb_typeof(options) = 'array' and jsonb_array_length(options) > 0)
    or (question_type <> 'single_choice' and options is null)
  );

-- A dependency needs both halves: which question gates this one, and which
-- of its answers open the gate.
alter table public.feedback_questions drop constraint if exists feedback_questions_dependency_shape;
alter table public.feedback_questions
  add constraint feedback_questions_dependency_shape check (
    (depends_on_question_id is null and depends_on_values is null)
    or (depends_on_question_id is not null and jsonb_typeof(depends_on_values) = 'array')
  );

comment on column public.feedback_questions.target_type is
  'course = asked once about the offering; lecturer = asked once per lecturer assigned to it.';
comment on column public.feedback_questions.options is
  'single_choice only: [{"value":"fully_physical","label":"Fully Physical"}, ...]';
comment on column public.feedback_questions.depends_on_values is
  'The gating question''s answers that reveal this one, e.g. ["yes"].';

-- ---------------------------------------------------------------------
-- Answers
-- ---------------------------------------------------------------------
alter table public.feedback_answers
  add column if not exists choice_value       text,
  add column if not exists lecturer_target_id uuid references public.lecturers(id) on delete set null;

-- One answer per question per submission — and, for lecturer-targeted
-- questions, one per lecturer. NULLS NOT DISTINCT so that the course-level
-- case (lecturer_target_id IS NULL) is also constrained; with default NULL
-- semantics a student could accumulate unlimited duplicate course answers.
drop index if exists feedback_answers_unique_per_target;
create unique index feedback_answers_unique_per_target
  on public.feedback_answers (submission_id, question_id, lecturer_target_id)
  nulls not distinct;

create index if not exists feedback_answers_lecturer_target_idx
  on public.feedback_answers (lecturer_target_id) where lecturer_target_id is not null;

-- ---------------------------------------------------------------------
-- Periods and submissions
-- ---------------------------------------------------------------------
alter table public.feedback_periods
  add column if not exists feedback_type text not null default 'end_semester';

alter table public.feedback_periods drop constraint if exists feedback_periods_feedback_type_check;
alter table public.feedback_periods
  add constraint feedback_periods_feedback_type_check
  check (feedback_type in ('mid_semester', 'end_semester'));

-- Ties a response to the delivery it is about, which is what makes
-- "feedback for the lecturers who actually taught this batch" resolvable.
alter table public.feedback_submissions
  add column if not exists offering_id uuid references public.course_offerings(id) on delete set null;

create index if not exists feedback_submissions_offering_idx
  on public.feedback_submissions (offering_id);

-- ---------------------------------------------------------------------
-- Resolving the offering a student's feedback is about
-- ---------------------------------------------------------------------
/** The delivery of a course that a given student actually sat: keyed on the
 *  student's own batch, so a repeat candidate's feedback attaches to the
 *  cohort they took it with rather than to whichever batch is current. */
create or replace function public.offering_for_student_course(
  p_student_id uuid,
  p_course_id uuid
)
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_offering uuid;
  v_batch    integer;
begin
  select batch_year into v_batch from public.students where id = p_student_id;
  if v_batch is null then
    return null;
  end if;

  -- Prefer the offering their result is already filed under; that is the
  -- authoritative link when it exists.
  select r.offering_id into v_offering
    from public.results r
   where r.student_id = p_student_id and r.course_id = p_course_id
     and r.offering_id is not null
   limit 1;
  if v_offering is not null then
    return v_offering;
  end if;

  -- Otherwise the offering for their batch. Where a batch somehow has more
  -- than one delivery of the same course, the most recent academic year
  -- wins — that is the one currently being taught.
  select o.id into v_offering
    from public.course_offerings o
   where o.course_id = p_course_id and o.batch_year = v_batch
   order by o.academic_year desc
   limit 1;
  return v_offering;
end;
$$;

revoke execute on function public.offering_for_student_course(uuid, uuid) from public, anon;
grant  execute on function public.offering_for_student_course(uuid, uuid) to authenticated;

-- Backfill the offering on responses already collected.
update public.feedback_submissions fs
   set offering_id = public.offering_for_student_course(fs.student_id, fs.course_id)
 where fs.offering_id is null;

-- ---------------------------------------------------------------------
-- Existing questions keep their meaning
-- ---------------------------------------------------------------------
-- The seeded bank was written as course-level questions with a free-text
-- `category`; promote that to a real section so ordering is explicit rather
-- than incidental to insertion order.
update public.feedback_questions
   set section_key   = coalesce(section_key, lower(regexp_replace(coalesce(category, 'general'), '\W+', '_', 'g'))),
       section_title = coalesce(section_title, category, 'General'),
       section_order = case when section_order = 0 then display_order else section_order end
 where section_key is null;
