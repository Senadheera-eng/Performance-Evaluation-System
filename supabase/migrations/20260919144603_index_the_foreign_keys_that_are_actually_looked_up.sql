-- Foreign keys the app filters or joins on, which had no index of their own.
--
-- attendance.course_id is the one that matters today: the department-admin
-- row policy on attendance is `course_id in (courses of my department)`, the
-- per-course attendance pages filter on it, and so does the dashboard
-- overview. The rest are "this student's X" or "this course's X" lookups
-- (and the cascade checks when a student or course is removed), which are
-- a sequential scan per call without an index.
--
-- Left unindexed on purpose: the audit columns (created_by, opened_by,
-- corrected_by, ...) — nothing reads by them, and every index is a cost on
-- every write.
create index if not exists attendance_course_idx on public.attendance (course_id);
create index if not exists medical_submissions_student_idx on public.medical_submissions (student_id);
create index if not exists medical_submission_courses_course_idx on public.medical_submission_courses (course_id);
create index if not exists medical_submission_files_submission_idx on public.medical_submission_files (submission_id);
create index if not exists attendance_checkins_student_idx on public.attendance_checkins (student_id);
create index if not exists attendance_presence_responses_student_idx on public.attendance_presence_responses (student_id);
create index if not exists curriculum_slots_course_idx on public.curriculum_slots (course_id);
create index if not exists enrollment_period_courses_course_idx on public.enrollment_period_courses (course_id);
create index if not exists feedback_period_questions_question_idx on public.feedback_period_questions (question_id);