-- fix_courses_unique_constraint_for_multi_semester_codes
-- Applied 20260705052856
-- Exported from the live project; do not edit by hand.


ALTER TABLE courses DROP CONSTRAINT courses_course_code_key;
ALTER TABLE courses ADD CONSTRAINT courses_code_dept_sem_key UNIQUE (course_code, department, semester);
