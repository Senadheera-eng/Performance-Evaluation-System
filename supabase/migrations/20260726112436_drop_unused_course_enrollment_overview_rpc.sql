-- drop_unused_course_enrollment_overview_rpc
-- Applied 20260726112436
-- Exported from the live project; do not edit by hand.

-- Superseded by nesting course data inside its owning enrollment period
-- (get_enrollment_period_course_stats / get_course_enrolled_students) -
-- the standalone period-independent "by course" view this backed was
-- removed from the UI, so nothing calls this anymore.
DROP FUNCTION IF EXISTS public.get_admin_course_enrollment_overview();
