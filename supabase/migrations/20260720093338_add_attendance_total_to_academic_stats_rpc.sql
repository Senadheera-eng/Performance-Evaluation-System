-- add_attendance_total_to_academic_stats_rpc
-- Applied 20260720093338
-- Exported from the live project; do not edit by hand.


DROP FUNCTION IF EXISTS public.get_all_students_academic_stats();

CREATE FUNCTION public.get_all_students_academic_stats()
RETURNS TABLE(
  student_id uuid,
  cgpa numeric,
  total_gpa_credits int,
  avg_attendance int,
  attendance_total int,
  enrolled_courses int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF get_my_role() NOT IN ('dept_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  WITH gpa_calc AS (
    SELECT r.student_id AS sid,
           SUM(r.gpv * c.credits) FILTER (WHERE c.contributes_to_gpa) AS weighted,
           SUM(c.credits) FILTER (WHERE c.contributes_to_gpa) AS credits
    FROM results r
    JOIN courses c ON c.id = r.course_id
    WHERE r.is_published = true AND r.gpv IS NOT NULL
    GROUP BY r.student_id
  ),
  att_calc AS (
    SELECT a.student_id AS sid,
           COUNT(*) FILTER (WHERE a.status IN ('present', 'excused')) AS present,
           COUNT(*) AS total
    FROM attendance a
    GROUP BY a.student_id
  ),
  enroll_calc AS (
    SELECT e.student_id AS sid, COUNT(*) AS cnt
    FROM enrollments e
    WHERE e.status = 'enrolled'
    GROUP BY e.student_id
  )
  SELECT s.id,
         ROUND((g.weighted / NULLIF(g.credits, 0))::numeric, 2),
         g.credits::int,
         CASE WHEN a.total > 0 THEN ROUND((a.present::numeric / a.total) * 100)::int ELSE 0 END,
         COALESCE(a.total, 0)::int,
         COALESCE(en.cnt, 0)::int
  FROM students s
  LEFT JOIN gpa_calc g ON g.sid = s.id
  LEFT JOIN att_calc a ON a.sid = s.id
  LEFT JOIN enroll_calc en ON en.sid = s.id
  WHERE s.role = 'student';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_all_students_academic_stats() TO authenticated;
