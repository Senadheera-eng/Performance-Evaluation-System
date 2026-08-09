-- create_ai_assistant_rpcs
-- Applied 20260705130407
-- Exported from the live project; do not edit by hand.


-- 1. Current academic standing (real CGPA, credits, current semester)
CREATE OR REPLACE FUNCTION get_academic_standing()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_department text;
  v_index_number text;
  v_total_credits numeric := 0;
  v_total_weighted numeric := 0;
  v_cgpa numeric := 0;
  v_max_semester int := 0;
BEGIN
  SELECT department, index_number INTO v_department, v_index_number
  FROM students WHERE id = v_student_id;

  SELECT
    COALESCE(SUM(c.credits), 0),
    COALESCE(SUM(c.credits * r.gpv), 0),
    COALESCE(MAX(c.semester), 0)
  INTO v_total_credits, v_total_weighted, v_max_semester
  FROM results r
  JOIN courses c ON c.id = r.course_id
  WHERE r.student_id = v_student_id
    AND r.is_published = true
    AND r.gpv IS NOT NULL
    AND c.contributes_to_gpa = true;

  IF v_total_credits > 0 THEN
    v_cgpa := ROUND((v_total_weighted / v_total_credits)::numeric, 2);
  END IF;

  RETURN jsonb_build_object(
    'department', v_department,
    'index_number', v_index_number,
    'current_cgpa', v_cgpa,
    'credits_completed', v_total_credits,
    'credits_remaining', GREATEST(0, 144 - v_total_credits),
    'highest_completed_semester', v_max_semester,
    'next_semester', v_max_semester + 1,
    'current_classification', CASE
      WHEN v_cgpa >= 3.70 THEN 'First Class Honours'
      WHEN v_cgpa >= 3.30 THEN 'Second Class Honours (Upper Division)'
      WHEN v_cgpa >= 3.00 THEN 'Second Class Honours (Lower Division)'
      WHEN v_cgpa >= 2.00 THEN 'Pass'
      ELSE 'Below Pass'
    END
  );
END;
$$;

-- 2. GPA target calculator — accepts ANY target CGPA (e.g. 3.5), not just classification boundaries
CREATE OR REPLACE FUNCTION calculate_gpa_target(p_target_cgpa numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_department text;
  v_total_credits numeric := 0;
  v_total_weighted numeric := 0;
  v_cgpa numeric := 0;
  v_max_semester int := 0;
  v_remaining_credits numeric;
  v_required_avg numeric;
  v_best_possible numeric;
  v_semester_breakdown jsonb := '[]'::jsonb;
  v_sem int;
  v_compulsory_credits numeric;
  v_elective_credits numeric;
  v_sem_total numeric;
BEGIN
  IF p_target_cgpa IS NULL OR p_target_cgpa < 0 OR p_target_cgpa > 4.0 THEN
    RETURN jsonb_build_object('error', 'target_cgpa must be between 0 and 4.0');
  END IF;

  SELECT department INTO v_department FROM students WHERE id = v_student_id;

  SELECT
    COALESCE(SUM(c.credits), 0),
    COALESCE(SUM(c.credits * r.gpv), 0),
    COALESCE(MAX(c.semester), 0)
  INTO v_total_credits, v_total_weighted, v_max_semester
  FROM results r
  JOIN courses c ON c.id = r.course_id
  WHERE r.student_id = v_student_id
    AND r.is_published = true
    AND r.gpv IS NOT NULL
    AND c.contributes_to_gpa = true;

  v_cgpa := CASE WHEN v_total_credits > 0 THEN v_total_weighted / v_total_credits ELSE 0 END;
  v_remaining_credits := GREATEST(0, 144 - v_total_credits);

  IF v_remaining_credits = 0 THEN
    RETURN jsonb_build_object(
      'already_graduated_credits', true,
      'current_cgpa', ROUND(v_cgpa::numeric, 2)
    );
  END IF;

  v_required_avg := (p_target_cgpa * 144 - v_cgpa * v_total_credits) / v_remaining_credits;
  v_best_possible := ROUND((((v_cgpa * v_total_credits) + v_remaining_credits * 4.0) / 144)::numeric, 2);

  -- Build real per-remaining-semester credit breakdown
  FOR v_sem IN (v_max_semester + 1)..8 LOOP
    SELECT COALESCE(SUM(credits), 0) INTO v_compulsory_credits
    FROM courses
    WHERE department = v_department AND semester = v_sem
      AND category = 'Compulsory' AND contributes_to_gpa = true;

    SELECT COALESCE(elective_credits, 0) INTO v_elective_credits
    FROM elective_credit_norms
    WHERE department = v_department AND semester = v_sem;

    v_sem_total := v_compulsory_credits + COALESCE(v_elective_credits, 0);

    v_semester_breakdown := v_semester_breakdown || jsonb_build_object(
      'semester', v_sem,
      'estimated_credits', v_sem_total
    );
  END LOOP;

  RETURN jsonb_build_object(
    'current_cgpa', ROUND(v_cgpa::numeric, 2),
    'credits_completed', v_total_credits,
    'remaining_credits', v_remaining_credits,
    'target_cgpa', p_target_cgpa,
    'required_avg_sgpa_per_remaining_semester', ROUND(GREATEST(0, LEAST(4.0, v_required_avg))::numeric, 2),
    'raw_required_avg', ROUND(v_required_avg::numeric, 3),
    'already_secured', v_required_avg <= 0,
    'feasible', v_required_avg <= 4.0,
    'best_possible_cgpa', v_best_possible,
    'semester_breakdown', v_semester_breakdown
  );
END;
$$;

-- 3. Upcoming (next semester) courses for the student's own department
CREATE OR REPLACE FUNCTION get_upcoming_courses()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_department text;
  v_max_semester int := 0;
  v_next_semester int;
  v_courses jsonb;
BEGIN
  SELECT department INTO v_department FROM students WHERE id = v_student_id;

  SELECT COALESCE(MAX(c.semester), 0) INTO v_max_semester
  FROM results r JOIN courses c ON c.id = r.course_id
  WHERE r.student_id = v_student_id AND r.is_published = true AND c.contributes_to_gpa = true;

  v_next_semester := v_max_semester + 1;

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
  WHERE department = v_department AND semester = v_next_semester;

  RETURN jsonb_build_object(
    'department', v_department,
    'next_semester', v_next_semester,
    'courses', COALESCE(v_courses, '[]'::jsonb)
  );
END;
$$;

-- 4. Look up a specific course by name or code (fuzzy match)
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
BEGIN
  SELECT department INTO v_department FROM students WHERE id = v_student_id;

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
  WHERE title ILIKE '%' || p_search || '%'
     OR course_code ILIKE '%' || p_search || '%'
  LIMIT 10;

  RETURN jsonb_build_object('matches', COALESCE(v_results, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION get_academic_standing() TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_gpa_target(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION get_upcoming_courses() TO authenticated;
GRANT EXECUTE ON FUNCTION get_course_info(text) TO authenticated;
