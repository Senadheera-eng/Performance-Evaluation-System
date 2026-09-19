-- course_feedback_student_rpcs
-- Applied 20260721030606
-- Exported from the live project; do not edit by hand.


CREATE OR REPLACE FUNCTION public.get_student_active_feedback_period()
RETURNS TABLE (
  id uuid, title text, academic_year text, semester int, batch_year int,
  opens_at timestamptz, closes_at timestamptz, status text, allow_editing boolean
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.id, p.title, p.academic_year, p.semester, p.batch_year, p.opens_at, p.closes_at, p.status, p.allow_editing
  FROM feedback_periods p
  JOIN students s ON s.id = auth.uid()
  WHERE p.status = 'open'
    AND (p.batch_year IS NULL OR p.batch_year = s.batch_year)
    AND now() BETWEEN p.opens_at AND p.closes_at
  ORDER BY p.opens_at DESC
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_student_eligible_feedback_courses(p_period_id uuid)
RETURNS TABLE (
  course_id uuid, course_code text, title text, credits int, semester int,
  category text, department text, lecturer_name text, submission_status text
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid := auth.uid();
  v_period record;
BEGIN
  SELECT * INTO v_period FROM feedback_periods WHERE id = p_period_id;
  IF v_period IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.id, c.course_code, c.title, c.credits, c.semester, c.category, c.department, c.lecturer_name,
    COALESCE(fs.status,
      CASE WHEN v_period.status = 'open' AND now() BETWEEN v_period.opens_at AND v_period.closes_at
           THEN 'pending' ELSE 'closed' END
    ) AS submission_status
  FROM feedback_period_courses fpc
  JOIN courses c ON c.id = fpc.course_id
  JOIN enrollments e ON e.course_id = c.id AND e.student_id = v_student_id AND e.status IN ('enrolled','completed')
  LEFT JOIN feedback_submissions fs ON fs.feedback_period_id = p_period_id AND fs.course_id = c.id AND fs.student_id = v_student_id
  WHERE fpc.feedback_period_id = p_period_id
  ORDER BY c.course_code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_student_feedback_form(p_period_id uuid, p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid := auth.uid();
  v_course jsonb;
  v_questions jsonb;
  v_submission jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', c.id, 'course_code', c.course_code, 'title', c.title, 'credits', c.credits,
    'semester', c.semester, 'category', c.category, 'department', c.department, 'lecturer_name', c.lecturer_name
  ) INTO v_course
  FROM courses c WHERE c.id = p_course_id;

  SELECT jsonb_agg(jsonb_build_object(
    'id', fq.id, 'question_text', fq.question_text, 'question_type', fq.question_type,
    'category', fq.category, 'display_order', fpq.display_order, 'is_required', fq.is_required
  ) ORDER BY fpq.display_order)
  INTO v_questions
  FROM feedback_period_questions fpq
  JOIN feedback_questions fq ON fq.id = fpq.question_id
  WHERE fpq.feedback_period_id = p_period_id AND fq.is_active;

  SELECT jsonb_build_object(
    'id', fs.id, 'status', fs.status, 'is_anonymous', fs.is_anonymous,
    'answers', (
      SELECT jsonb_agg(jsonb_build_object('question_id', fa.question_id, 'rating_value', fa.rating_value, 'text_value', fa.text_value))
      FROM feedback_answers fa WHERE fa.submission_id = fs.id
    )
  ) INTO v_submission
  FROM feedback_submissions fs
  WHERE fs.feedback_period_id = p_period_id AND fs.course_id = p_course_id AND fs.student_id = v_student_id;

  RETURN jsonb_build_object('course', v_course, 'questions', COALESCE(v_questions, '[]'::jsonb), 'submission', v_submission);
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_feedback_draft(
  p_period_id uuid, p_course_id uuid, p_is_anonymous boolean, p_answers jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid := auth.uid();
  v_submission_id uuid;
  v_period record;
  v_answer jsonb;
BEGIN
  SELECT * INTO v_period FROM feedback_periods WHERE id = p_period_id;
  IF v_period IS NULL OR v_period.status <> 'open' OR now() < v_period.opens_at OR now() > v_period.closes_at THEN
    RAISE EXCEPTION 'This feedback period has already closed.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM feedback_period_courses fpc WHERE fpc.feedback_period_id = p_period_id AND fpc.course_id = p_course_id) THEN
    RAISE EXCEPTION 'You are not eligible to submit feedback for this course.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = v_student_id AND e.course_id = p_course_id AND e.status IN ('enrolled','completed')) THEN
    RAISE EXCEPTION 'You are not eligible to submit feedback for this course.';
  END IF;

  INSERT INTO feedback_submissions (feedback_period_id, student_id, course_id, is_anonymous, status)
  VALUES (p_period_id, v_student_id, p_course_id, p_is_anonymous, 'draft')
  ON CONFLICT (feedback_period_id, student_id, course_id)
  DO UPDATE SET is_anonymous = excluded.is_anonymous, updated_at = now()
  WHERE feedback_submissions.status = 'draft'
  RETURNING id INTO v_submission_id;

  IF v_submission_id IS NULL THEN
    RAISE EXCEPTION 'You have already submitted feedback for this course.';
  END IF;

  DELETE FROM feedback_answers WHERE submission_id = v_submission_id;
  FOR v_answer IN SELECT * FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb))
  LOOP
    INSERT INTO feedback_answers (submission_id, question_id, rating_value, text_value)
    VALUES (
      v_submission_id,
      (v_answer->>'question_id')::uuid,
      NULLIF(v_answer->>'rating_value','')::int,
      NULLIF(v_answer->>'text_value','')
    );
  END LOOP;

  RETURN v_submission_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_course_feedback(
  p_period_id uuid, p_course_id uuid, p_is_anonymous boolean, p_answers jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid := auth.uid();
  v_submission_id uuid;
  v_period record;
  v_missing_required int;
  v_answer jsonb;
BEGIN
  SELECT * INTO v_period FROM feedback_periods WHERE id = p_period_id;
  IF v_period IS NULL OR v_period.status <> 'open' OR now() < v_period.opens_at OR now() > v_period.closes_at THEN
    RAISE EXCEPTION 'This feedback period has already closed.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM feedback_period_courses fpc WHERE fpc.feedback_period_id = p_period_id AND fpc.course_id = p_course_id) THEN
    RAISE EXCEPTION 'You are not eligible to submit feedback for this course.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = v_student_id AND e.course_id = p_course_id AND e.status IN ('enrolled','completed')) THEN
    RAISE EXCEPTION 'You are not eligible to submit feedback for this course.';
  END IF;

  SELECT count(*) INTO v_missing_required
  FROM feedback_period_questions fpq
  JOIN feedback_questions fq ON fq.id = fpq.question_id
  WHERE fpq.feedback_period_id = p_period_id
    AND fq.is_required
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_answers) a
      WHERE (a->>'question_id')::uuid = fq.id
        AND (
          (fq.question_type = 'rating' AND (a->>'rating_value') IS NOT NULL)
          OR (fq.question_type <> 'rating' AND COALESCE(trim(a->>'text_value'), '') <> '')
        )
    );

  IF v_missing_required > 0 THEN
    RAISE EXCEPTION 'Please answer all required questions.';
  END IF;

  INSERT INTO feedback_submissions (feedback_period_id, student_id, course_id, is_anonymous, status, submitted_at)
  VALUES (p_period_id, v_student_id, p_course_id, p_is_anonymous, 'submitted', now())
  ON CONFLICT (feedback_period_id, student_id, course_id)
  DO UPDATE SET
    is_anonymous = excluded.is_anonymous,
    status = 'submitted',
    submitted_at = now(),
    updated_at = now()
  WHERE feedback_submissions.status = 'draft' OR v_period.allow_editing
  RETURNING id INTO v_submission_id;

  IF v_submission_id IS NULL THEN
    RAISE EXCEPTION 'You have already submitted feedback for this course.';
  END IF;

  DELETE FROM feedback_answers WHERE submission_id = v_submission_id;
  FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    INSERT INTO feedback_answers (submission_id, question_id, rating_value, text_value)
    VALUES (
      v_submission_id,
      (v_answer->>'question_id')::uuid,
      NULLIF(v_answer->>'rating_value','')::int,
      NULLIF(v_answer->>'text_value','')
    );
  END LOOP;

  RETURN v_submission_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_student_active_feedback_period() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_eligible_feedback_courses(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_feedback_form(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_feedback_draft(uuid, uuid, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_course_feedback(uuid, uuid, boolean, jsonb) TO authenticated;
