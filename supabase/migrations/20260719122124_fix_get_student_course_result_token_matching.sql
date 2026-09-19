-- fix_get_student_course_result_token_matching
-- Applied 20260719122124
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
  v_tokens text[];
BEGIN
  IF p_search IS NULL OR btrim(p_search) = '' THEN
    RETURN jsonb_build_object('error', 'Please provide a course code or name.');
  END IF;

  v_tokens := regexp_split_to_array(trim(p_search), '\s+');

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
    AND (
      c.course_code ILIKE '%' || p_search || '%'
      OR (
        SELECT bool_and(
          CASE
            WHEN tok ~* '^[ivxlcdm]+$' AND length(tok) <= 4
              THEN c.title ~* ('\y' || tok || '\y')
            ELSE c.title ILIKE '%' || tok || '%'
          END
        )
        FROM unnest(v_tokens) AS tok
        WHERE length(tok) > 0
      )
    );

  RETURN jsonb_build_object(
    'search', p_search,
    'results', COALESCE(v_results, '[]'::jsonb)
  );
END;
$function$;
