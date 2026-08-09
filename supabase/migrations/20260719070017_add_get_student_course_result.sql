-- add_get_student_course_result
-- Applied 20260719070017
-- Exported from the live project; do not edit by hand.

CREATE OR REPLACE FUNCTION public.get_student_course_result(p_search text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid := auth.uid();
  v_results jsonb;
BEGIN
  IF p_search IS NULL OR btrim(p_search) = '' THEN
    RETURN jsonb_build_object('error', 'Please provide a course code or name.');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'course_code', c.course_code,
    'title', c.title,
    'semester', c.semester,
    'credits', c.credits,
    'grade', r.grade,
    'grade_point', r.gpv,
    'is_published', r.is_published
  ) ORDER BY c.semester)
  INTO v_results
  FROM results r
  JOIN courses c ON c.id = r.course_id
  WHERE r.student_id = v_student_id
    AND (c.course_code ILIKE '%' || p_search || '%' OR c.title ILIKE '%' || p_search || '%');

  RETURN jsonb_build_object(
    'search', p_search,
    'results', COALESCE(v_results, '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_student_course_result(text) TO anon, authenticated, service_role;
