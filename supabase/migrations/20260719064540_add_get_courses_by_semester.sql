-- add_get_courses_by_semester
-- Applied 20260719064540
-- Exported from the live project; do not edit by hand.

CREATE OR REPLACE FUNCTION public.get_courses_by_semester(p_semester int)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid := auth.uid();
  v_department text;
  v_courses jsonb;
BEGIN
  IF p_semester IS NULL OR p_semester < 1 OR p_semester > 8 THEN
    RETURN jsonb_build_object('error', 'Semester must be between 1 and 8.');
  END IF;

  SELECT department INTO v_department FROM students WHERE id = v_student_id;

  SELECT jsonb_agg(jsonb_build_object(
    'code', course_code,
    'title', title,
    'credits', credits,
    'category', category,
    'minor_category', minor_category,
    'contributes_to_gpa', contributes_to_gpa
  ) ORDER BY course_code)
  INTO v_courses
  FROM courses
  WHERE department = v_department AND semester = p_semester;

  RETURN jsonb_build_object(
    'department', v_department,
    'semester', p_semester,
    'courses', COALESCE(v_courses, '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_courses_by_semester(int) TO anon, authenticated, service_role;
