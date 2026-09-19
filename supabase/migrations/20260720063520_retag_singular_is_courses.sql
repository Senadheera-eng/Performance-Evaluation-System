-- retag_singular_is_courses
-- Applied 20260720063520
-- Exported from the live project; do not edit by hand.


UPDATE courses
SET department = 'Interdisciplinary Studies'
WHERE course_code IN ('IS3151','IS3162','IS3201','IS3202','IS3203','IS3261','IS3263','IS3264')
  AND department != 'Interdisciplinary Studies';
