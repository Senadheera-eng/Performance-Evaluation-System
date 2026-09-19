-- drop_stale_feedback_answer_uniqueness_blocking_lecturer_targeting
-- Applied 20260809064426
-- Exported from the live project; do not edit by hand.

-- feedback_answers still carried unique (submission_id, question_id) from
-- before questions could be asked about a particular lecturer. The redesign
-- added feedback_answers_unique_per_target — the same key plus
-- lecturer_target_id, NULLS NOT DISTINCT so a course-level question still
-- cannot be answered twice — but never dropped the original, and the original
-- forbids exactly what targeting exists to do.
--
-- The effect: on a course with two assigned lecturers, a student's second
-- lecturer answer is rejected. write_feedback_answers inserts one row per
-- answer, so the whole submission fails. Every multi-lecturer course in the
-- faculty would have broken on the first submission.

alter table public.feedback_answers
  drop constraint if exists feedback_answers_submission_id_question_id_key;

drop index if exists public.feedback_answers_submission_id_question_id_key;
