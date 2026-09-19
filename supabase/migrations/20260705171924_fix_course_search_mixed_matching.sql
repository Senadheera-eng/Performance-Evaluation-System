-- fix_course_search_mixed_matching
-- Applied 20260705171924
-- Exported from the live project; do not edit by hand.


CREATE OR REPLACE FUNCTION get_course_info(p_search text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_department text;
  v_results jsonb;
  v_tokens text[];
BEGIN
  SELECT department INTO v_department FROM students WHERE id = v_student_id;

  v_tokens := regexp_split_to_array(trim(p_search), '\s+');

  SELECT jsonb_agg(jsonb_build_object(
    'code', course_code,
    'title', title,
    'credits', credits,
    'department', department,
    'semester', semester,
    'year', year,
    'category', category,
    'minor_category', minor_category,
    'contributes_to_gpa', contributes_to_gpa
  ) ORDER BY (department = v_department) DESC, semester)
  INTO v_results
  FROM courses
  WHERE course_code ILIKE '%' || p_search || '%'
     OR (
       -- Each token must appear in the title. Roman-numeral-shaped tokens
       -- (I, V, IV, VI, X...) require a whole-word match (so "V" doesn't
       -- false-match inside "IV"); ordinary word tokens use substring
       -- matching (so "math" still matches "Mathematics").
       SELECT bool_and(
         CASE
           WHEN tok ~* '^[ivxlcdm]+$' AND length(tok) <= 4
             THEN title ~* ('\y' || tok || '\y')
           ELSE title ILIKE '%' || tok || '%'
         END
       )
       FROM unnest(v_tokens) AS tok
       WHERE length(tok) > 0
     )
  LIMIT 10;

  RETURN jsonb_build_object('matches', COALESCE(v_results, '[]'::jsonb));
END;
$$;
