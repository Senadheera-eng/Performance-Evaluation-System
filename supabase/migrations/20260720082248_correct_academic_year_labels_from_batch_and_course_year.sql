-- correct_academic_year_labels_from_batch_and_course_year
-- Applied 20260720082248
-- Exported from the live project; do not edit by hand.


UPDATE results r
SET academic_year = (s.batch_year + c.year - 1)::text || '/' || (s.batch_year + c.year)::text
FROM students s, courses c
WHERE r.student_id = s.id AND r.course_id = c.id;

UPDATE enrollments e
SET academic_year = (s.batch_year + c.year - 1)::text || '/' || (s.batch_year + c.year)::text
FROM students s, courses c
WHERE e.student_id = s.id AND e.course_id = c.id;
