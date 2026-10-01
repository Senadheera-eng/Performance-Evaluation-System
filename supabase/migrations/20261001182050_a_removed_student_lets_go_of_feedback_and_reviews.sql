-- Removing a batch deletes its students, and two links refused that:
--
--   * Course feedback. feedback_submissions.student_id now lets go to NULL,
--     so a removed batch's answers stay in the courses' feedback reports,
--     anonymously. Response counts are counts of submissions, so they do not
--     change. (remove_batch can delete the answers instead when asked.)
--   * medical_submissions.reviewed_by. A reviewer is an admin now, but the
--     column still points at students; it lets go to NULL too.
--
-- Everything else a student owns already goes with them.
set local lock_timeout = '10s';

alter table public.feedback_submissions alter column student_id drop not null;
alter table public.feedback_submissions
  drop constraint feedback_submissions_student_id_fkey,
  add constraint feedback_submissions_student_id_fkey
    foreign key (student_id) references public.students (id) on delete set null;

alter table public.medical_submissions
  drop constraint medical_submissions_reviewed_by_fkey,
  add constraint medical_submissions_reviewed_by_fkey
    foreign key (reviewed_by) references public.students (id) on delete set null;
