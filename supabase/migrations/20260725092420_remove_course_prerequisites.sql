-- remove_course_prerequisites
-- Applied 20260725092420
-- Exported from the live project; do not edit by hand.


-- Removed at the project owner's direction: there is no reliable official
-- prerequisite data for this faculty, and the previously seeded links were
-- inferred from course-title numbering rather than sourced from the
-- handbook. Rather than ship inferred academic rules, the model is dropped.
DROP FUNCTION IF EXISTS public.student_meets_prerequisites(uuid, uuid);
DROP TABLE IF EXISTS public.course_prerequisites;
