-- course_feedback_admin_rpcs
-- Applied 20260721030649
-- Exported from the live project; do not edit by hand.


CREATE OR REPLACE FUNCTION public.get_admin_feedback_summary(
  p_period_id uuid DEFAULT NULL, p_course_id uuid DEFAULT NULL, p_batch_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_role text := get_my_role();
  v_dept text := get_my_department();
  v_total_eligible int;
  v_submitted int;
  v_anon int;
  v_non_anon int;
  v_avg numeric;
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT count(DISTINCT e.student_id) INTO v_total_eligible
  FROM enrollments e
  JOIN courses c ON c.id = e.course_id
  JOIN feedback_period_courses fpc ON fpc.course_id = c.id
  WHERE e.status IN ('enrolled','completed')
    AND (p_period_id IS NULL OR fpc.feedback_period_id = p_period_id)
    AND (v_role = 'super_admin' OR c.department = v_dept)
    AND (p_course_id IS NULL OR c.id = p_course_id)
    AND (p_batch_year IS NULL OR EXISTS (SELECT 1 FROM students s WHERE s.id = e.student_id AND s.batch_year = p_batch_year));

  SELECT count(*), count(*) FILTER (WHERE fs.is_anonymous), count(*) FILTER (WHERE NOT fs.is_anonymous)
  INTO v_submitted, v_anon, v_non_anon
  FROM feedback_submissions fs
  JOIN courses c ON c.id = fs.course_id
  WHERE fs.status = 'submitted'
    AND (p_period_id IS NULL OR fs.feedback_period_id = p_period_id)
    AND (v_role = 'super_admin' OR c.department = v_dept)
    AND (p_course_id IS NULL OR fs.course_id = p_course_id)
    AND (p_batch_year IS NULL OR EXISTS (SELECT 1 FROM students s WHERE s.id = fs.student_id AND s.batch_year = p_batch_year));

  SELECT avg(fa.rating_value) INTO v_avg
  FROM feedback_answers fa
  JOIN feedback_submissions fs ON fs.id = fa.submission_id
  JOIN courses c ON c.id = fs.course_id
  WHERE fs.status = 'submitted' AND fa.rating_value IS NOT NULL
    AND (p_period_id IS NULL OR fs.feedback_period_id = p_period_id)
    AND (v_role = 'super_admin' OR c.department = v_dept)
    AND (p_course_id IS NULL OR fs.course_id = p_course_id)
    AND (p_batch_year IS NULL OR EXISTS (SELECT 1 FROM students s WHERE s.id = fs.student_id AND s.batch_year = p_batch_year));

  RETURN jsonb_build_object(
    'total_eligible', v_total_eligible,
    'submitted', v_submitted,
    'pending', greatest(0, v_total_eligible - v_submitted),
    'response_rate', CASE WHEN v_total_eligible > 0 THEN round((v_submitted::numeric / v_total_eligible) * 100, 1) ELSE 0 END,
    'anonymous_count', v_anon,
    'non_anonymous_count', v_non_anon,
    'overall_avg_rating', round(COALESCE(v_avg, 0)::numeric, 2)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_course_feedback_analytics(p_period_id uuid)
RETURNS TABLE (
  course_id uuid, course_code text, title text, department text, semester int,
  eligible_count int, response_count int, response_rate numeric,
  avg_rating numeric, anonymous_count int, non_anonymous_count int
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
  SELECT c.id, c.course_code, c.title, c.department, c.semester,
    (SELECT count(DISTINCT e.student_id) FROM enrollments e WHERE e.course_id = c.id AND e.status IN ('enrolled','completed'))::int,
    count(fs.id) FILTER (WHERE fs.status = 'submitted')::int,
    CASE WHEN (SELECT count(DISTINCT e.student_id) FROM enrollments e WHERE e.course_id = c.id AND e.status IN ('enrolled','completed')) > 0
      THEN round(count(fs.id) FILTER (WHERE fs.status = 'submitted')::numeric /
        (SELECT count(DISTINCT e.student_id) FROM enrollments e WHERE e.course_id = c.id AND e.status IN ('enrolled','completed')) * 100, 1)
      ELSE 0 END,
    round(avg(fa.rating_value) FILTER (WHERE fs.status = 'submitted'), 2),
    count(fs.id) FILTER (WHERE fs.status = 'submitted' AND fs.is_anonymous)::int,
    count(fs.id) FILTER (WHERE fs.status = 'submitted' AND NOT fs.is_anonymous)::int
  FROM feedback_period_courses fpc
  JOIN courses c ON c.id = fpc.course_id
  LEFT JOIN feedback_submissions fs ON fs.course_id = c.id AND fs.feedback_period_id = fpc.feedback_period_id
  LEFT JOIN feedback_answers fa ON fa.submission_id = fs.id
  WHERE fpc.feedback_period_id = p_period_id
    AND (v_role = 'super_admin' OR c.department = v_dept)
  GROUP BY c.id, c.course_code, c.title, c.department, c.semester
  ORDER BY c.course_code;
END;
$function$;

-- Rating-question analytics. When a specific course is requested, small
-- filtered groups (fewer than 5 submitted responses for that course) are
-- suppressed entirely to prevent indirect deanonymisation.
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
  v_course_response_count int;
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  IF p_course_id IS NOT NULL THEN
    SELECT count(*) INTO v_course_response_count
    FROM feedback_submissions fs
    JOIN courses c ON c.id = fs.course_id
    WHERE fs.feedback_period_id = p_period_id AND fs.course_id = p_course_id AND fs.status = 'submitted'
      AND (v_role = 'super_admin' OR c.department = v_dept);
    IF v_course_response_count < 5 THEN
      RETURN;
    END IF;
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

-- Written comments, identity-masked at the join level (not just column
-- nulling): the students join predicate itself excludes anonymous rows, so
-- there is no query shape that pulls identity alongside an anonymous
-- comment. Small course-level groups are suppressed for the same reason as
-- the question analytics above.
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
  v_course_response_count int;
BEGIN
  IF v_role NOT IN ('dept_admin','super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  IF p_course_id IS NOT NULL THEN
    SELECT count(*) INTO v_course_response_count
    FROM feedback_submissions fs
    JOIN courses c ON c.id = fs.course_id
    WHERE fs.feedback_period_id = p_period_id AND fs.course_id = p_course_id AND fs.status = 'submitted'
      AND (v_role = 'super_admin' OR c.department = v_dept);
    IF v_course_response_count < 5 THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
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
  LEFT JOIN students s ON s.id = fs.student_id AND NOT fs.is_anonymous
  WHERE fs.feedback_period_id = p_period_id
    AND (v_role = 'super_admin' OR c.department = v_dept)
    AND (p_course_id IS NULL OR fs.course_id = p_course_id)
    AND COALESCE(trim(fa.text_value), '') <> ''
  ORDER BY fs.submitted_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_feedback_periods()
RETURNS TABLE (
  id uuid, title text, academic_year text, semester int, batch_year int,
  department text, opens_at timestamptz, closes_at timestamptz, status text, allow_editing boolean
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
  SELECT p.id, p.title, p.academic_year, p.semester, p.batch_year, p.department, p.opens_at, p.closes_at, p.status, p.allow_editing
  FROM feedback_periods p
  WHERE v_role = 'super_admin' OR p.department = v_dept
  ORDER BY p.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_admin_feedback_summary(uuid, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_course_feedback_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_question_feedback_analytics(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_feedback_comments(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_feedback_periods() TO authenticated;
