-- attendance_unique_per_student_course_date
-- Applied 20260808121001
-- Exported from the live project; do not edit by hand.

-- One attendance record per student per course per lecture date. Without
-- this, re-marking a date inserts a second row rather than correcting the
-- first, which silently doubles the denominator behind every attendance
-- percentage and eligibility decision — and the admin page's save loop had
-- no way to detect it. Verified zero duplicates before adding.
--
-- Also what lets the marking UI upsert a whole class in one request instead
-- of a sequential update-or-insert per student.
create unique index if not exists attendance_student_course_date_key
  on public.attendance (student_id, course_id, lecture_date);
