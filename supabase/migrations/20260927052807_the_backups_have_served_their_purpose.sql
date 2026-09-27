-- The backups have served their purpose.
--
-- Each of these was a dated copy taken before a data migration: the
-- 20260829 pair before enrolments and feedback were reshaped, the 20260921
-- set before feedback rounds were rebuilt around per-course forms and a
-- mistaken enrolment window was cleared. Both migrations have since run and
-- been checked against the live screens, so the copies protect nothing.
--
-- They were not harmless to keep. enrollments_backup_20260829 had row level
-- security switched off, the one table in the schema the security advisor
-- flags as critical; it was unreachable only because no grant happened to
-- reach it, which is an accident rather than a rule. The rest held student
-- enrolments and feedback answers with no policy at all. Nothing references
-- any of them: no view, no foreign key, no function.

drop table if exists public.enrollments_backup_20260829;
drop table if exists public.feedback_backup_20260829;

drop table if exists public.feedback_answers_backup_20260921;
drop table if exists public.feedback_submissions_backup_20260921;
drop table if exists public.feedback_period_questions_backup_20260921;
drop table if exists public.feedback_period_courses_backup_20260921;
drop table if exists public.feedback_questions_backup_20260921;
drop table if exists public.feedback_periods_backup_20260921;
drop table if exists public.enrollment_periods_backup_20260921;
drop table if exists public.enrollments_cleared_backup_20260921;
