-- fix_feedback_small_group_suppression
-- Applied 20260721031056
-- Exported from the live project; do not edit by hand.


-- Previous version only suppressed small groups when a course filter was
-- explicitly passed — the unfiltered (period-wide) view still returned
-- every row tagged with its course, which is the exact same information a
-- course-filtered call would have revealed. Apply the threshold to every
-- row's owning course unconditionally instead.
CREATE OR REPLACE FUNCTION public.get_admin_feedback_comments(p_period_id uuid, p_course_id uuid DEFAULT NULL)
RETURNS TABLE (
  submission_id uuid, course_code text, course_title text, question_category text, question_text text,
  comment text, is_anonymous boolean, student_name text, student_reg text, submitted_date date
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_role text := get_my_role();
  v_dept text := get_my_department();
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  WITH course_counts AS (
    SELECT fs.course_id, count(*) AS n
    FROM feedback_submissions fs
    WHERE fs.feedback_period_id = p_period_id AND fs.status = 'submitted'
    GROUP BY fs.course_id
  )
  SELECT fs.id, c.course_code, c.title, fq.category, fq.question_text,
    fa.text_value,
    fs.is_anonymous,
    s.name,
    s.reg_number,
    fs.submitted_at::date
  FROM feedback_answers fa
  JOIN feedback_submissions fs ON fs.id = fa.submission_id AND fs.status = 'submitted'
  JOIN courses c ON c.id = fs.course_id
  JOIN feedback_questions fq ON fq.id = fa.question_id AND fq.question_type IN ('short_text','long_text')
  JOIN course_counts cc ON cc.course_id = fs.course_id AND cc.n >= 5
  LEFT JOIN students s ON s.id = fs.student_id AND NOT fs.is_anonymous
  WHERE fs.feedback_period_id = p_period_id
    AND (v_role = 'super_admin' OR c.department = v_dept)
    AND (p_course_id IS NULL OR fs.course_id = p_course_id)
    AND COALESCE(trim(fa.text_value), '') <> ''
  ORDER BY fs.submitted_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_question_feedback_analytics(p_period_id uuid, p_course_id uuid DEFAULT NULL)
RETURNS TABLE (
  question_id uuid, question_text text, category text,
  response_count int, avg_rating numeric,
  count_1 int, count_2 int, count_3 int, count_4 int, count_5 int,
  pct_positive numeric, pct_neutral numeric, pct_negative numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_role text := get_my_role();
  v_dept text := get_my_department();
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- When scoped to a single course, that course must clear the minimum
  -- response threshold. The unscoped (period-wide, multi-course) view is
  -- inherently aggregated across many students and isn't subject to the
  -- same single-course deanonymisation risk, so it is not gated here.
  IF p_course_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM feedback_submissions fs JOIN courses c ON c.id = fs.course_id
    WHERE fs.feedback_period_id = p_period_id AND fs.course_id = p_course_id AND fs.status = 'submitted'
      AND (v_role = 'super_admin' OR c.department = v_dept)
    GROUP BY fs.course_id HAVING count(*) >= 5
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT fq.id, fq.question_text, fq.category,
    count(fa.id)::int,
    round(avg(fa.rating_value), 2),
    count(*) FILTER (WHERE fa.rating_value = 1)::int,
    count(*) FILTER (WHERE fa.rating_value = 2)::int,
    count(*) FILTER (WHERE fa.rating_value = 3)::int,
    count(*) FILTER (WHERE fa.rating_value = 4)::int,
    count(*) FILTER (WHERE fa.rating_value = 5)::int,
    round(count(*) FILTER (WHERE fa.rating_value >= 4)::numeric / NULLIF(count(fa.id), 0) * 100, 1),
    round(count(*) FILTER (WHERE fa.rating_value = 3)::numeric / NULLIF(count(fa.id), 0) * 100, 1),
    round(count(*) FILTER (WHERE fa.rating_value <= 2)::numeric / NULLIF(count(fa.id), 0) * 100, 1)
  FROM feedback_period_questions fpq
  JOIN feedback_questions fq ON fq.id = fpq.question_id AND fq.question_type = 'rating'
  JOIN feedback_answers fa ON fa.question_id = fq.id
  JOIN feedback_submissions fs ON fs.id = fa.submission_id AND fs.status = 'submitted'
  JOIN courses c ON c.id = fs.course_id
  WHERE fpq.feedback_period_id = p_period_id
    AND (v_role = 'super_admin' OR c.department = v_dept)
    AND (p_course_id IS NULL OR fs.course_id = p_course_id)
  GROUP BY fq.id, fq.question_text, fq.category, fpq.display_order
  ORDER BY fpq.display_order;
END;
$function$;
