-- add_get_student_results
-- Applied 20260719070005
-- Exported from the live project; do not edit by hand.

CREATE OR REPLACE FUNCTION public.get_student_results(p_semester int DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid := auth.uid();
  v_results jsonb;
  v_total_credits numeric := 0;
  v_total_weighted numeric := 0;
  v_gpa numeric;
BEGIN
  IF p_semester IS NOT NULL AND (p_semester < 1 OR p_semester > 8) THEN
    RETURN jsonb_build_object('error', 'Semester must be between 1 and 8.');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'course_code', c.course_code,
    'title', c.title,
    'semester', c.semester,
    'credits', c.credits,
    'grade', r.grade,
    'grade_point', r.gpv,
    'contributes_to_gpa', c.contributes_to_gpa
  ) ORDER BY c.semester, c.course_code)
  INTO v_results
  FROM results r
  JOIN courses c ON c.id = r.course_id
  WHERE r.student_id = v_student_id
    AND r.is_published = true
    AND (p_semester IS NULL OR c.semester = p_semester);

  SELECT
    COALESCE(SUM(c.credits), 0),
    COALESCE(SUM(c.credits * r.gpv), 0)
  INTO v_total_credits, v_total_weighted
  FROM results r
  JOIN courses c ON c.id = r.course_id
  WHERE r.student_id = v_student_id
    AND r.is_published = true
    AND r.gpv IS NOT NULL
    AND c.contributes_to_gpa = true
    AND (p_semester IS NULL OR c.semester = p_semester);

  IF v_total_credits > 0 THEN
    v_gpa := ROUND((v_total_weighted / v_total_credits)::numeric, 2);
  END IF;

  RETURN jsonb_build_object(
    'semester', p_semester,
    'results', COALESCE(v_results, '[]'::jsonb),
    'gpa', v_gpa,
    'gpa_credits', v_total_credits
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_student_results(int) TO anon, authenticated, service_role;
