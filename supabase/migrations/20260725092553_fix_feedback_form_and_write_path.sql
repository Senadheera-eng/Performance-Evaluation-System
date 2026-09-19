-- fix_feedback_form_and_write_path
-- Applied 20260725092553
-- Exported from the live project; do not edit by hand.


-- The form loader now reports *why* it can't serve a form instead of
-- returning a shape the UI can't distinguish from "still loading", and it
-- tells the client whether editing is currently permitted.
CREATE OR REPLACE FUNCTION public.get_student_feedback_form(p_period_id uuid, p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid := auth.uid();
  v_period record;
  v_course jsonb;
  v_questions jsonb;
  v_submission jsonb;
  v_open boolean;
  v_can_edit boolean;
BEGIN
  SELECT * INTO v_period FROM feedback_periods WHERE id = p_period_id;
  IF v_period IS NULL THEN
    RETURN jsonb_build_object('error', 'period_not_found');
  END IF;

  IF NOT student_eligible_for_feedback(v_student_id, p_period_id, p_course_id) THEN
    RETURN jsonb_build_object('error', 'not_eligible');
  END IF;

  SELECT jsonb_build_object(
    'id', c.id, 'course_code', c.course_code, 'title', c.title,
    'credits', c.credits, 'semester', c.semester, 'category', c.category,
    'department', c.department, 'lecturer_name', c.lecturer_name
  ) INTO v_course
  FROM courses c WHERE c.id = p_course_id;

  SELECT jsonb_agg(jsonb_build_object(
    'id', fq.id, 'question_text', fq.question_text, 'question_type', fq.question_type,
    'category', fq.category, 'display_order', fpq.display_order,
    'is_required', fq.is_required
  ) ORDER BY fpq.display_order)
  INTO v_questions
  FROM feedback_period_questions fpq
  JOIN feedback_questions fq ON fq.id = fpq.question_id
  WHERE fpq.feedback_period_id = p_period_id AND fq.is_active;

  IF v_questions IS NULL OR jsonb_array_length(v_questions) = 0 THEN
    RETURN jsonb_build_object('error', 'no_questions', 'course', v_course);
  END IF;

  SELECT jsonb_build_object(
    'id', fs.id, 'status', fs.status, 'is_anonymous', fs.is_anonymous,
    'answers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'question_id', fa.question_id,
        'rating_value', fa.rating_value,
        'text_value', fa.text_value))
      FROM feedback_answers fa WHERE fa.submission_id = fs.id
    ), '[]'::jsonb)
  ) INTO v_submission
  FROM feedback_submissions fs
  WHERE fs.feedback_period_id = p_period_id
    AND fs.course_id = p_course_id
    AND fs.student_id = v_student_id;

  v_open := v_period.status = 'open'
            AND now() BETWEEN v_period.opens_at AND v_period.closes_at;
  v_can_edit := v_open AND (
    v_submission IS NULL
    OR v_submission->>'status' = 'draft'
    OR v_period.allow_editing
  );

  RETURN jsonb_build_object(
    'course', v_course,
    'questions', v_questions,
    'submission', v_submission,
    'period_open', v_open,
    'allow_editing', v_period.allow_editing,
    'can_edit', v_can_edit
  );
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
  IF v_period IS NULL OR v_period.status <> 'open'
     OR now() NOT BETWEEN v_period.opens_at AND v_period.closes_at THEN
    RAISE EXCEPTION 'This feedback period has already closed.';
  END IF;

  IF NOT student_eligible_for_feedback(v_student_id, p_period_id, p_course_id) THEN
    RAISE EXCEPTION 'You are not eligible to submit feedback for this course.';
  END IF;

  INSERT INTO feedback_submissions (feedback_period_id, student_id, course_id, is_anonymous, status)
  VALUES (p_period_id, v_student_id, p_course_id, p_is_anonymous, 'draft')
  ON CONFLICT (feedback_period_id, student_id, course_id)
  DO UPDATE SET is_anonymous = excluded.is_anonymous, updated_at = now()
  WHERE feedback_submissions.status = 'draft'
  RETURNING id INTO v_submission_id;

  IF v_submission_id IS NULL THEN
    RAISE EXCEPTION 'Your response has already been submitted.';
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
  IF v_period IS NULL OR v_period.status <> 'open'
     OR now() NOT BETWEEN v_period.opens_at AND v_period.closes_at THEN
    RAISE EXCEPTION 'This feedback period has already closed.';
  END IF;

  IF NOT student_eligible_for_feedback(v_student_id, p_period_id, p_course_id) THEN
    RAISE EXCEPTION 'You are not eligible to submit feedback for this course.';
  END IF;

  SELECT count(*) INTO v_missing_required
  FROM feedback_period_questions fpq
  JOIN feedback_questions fq ON fq.id = fpq.question_id
  WHERE fpq.feedback_period_id = p_period_id
    AND fq.is_active
    AND fq.is_required
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) a
      WHERE (a->>'question_id')::uuid = fq.id
        AND (
          (fq.question_type = 'rating' AND (a->>'rating_value') IS NOT NULL
             AND (a->>'rating_value') <> '')
          OR (fq.question_type <> 'rating'
             AND COALESCE(trim(a->>'text_value'), '') <> '')
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
    RAISE EXCEPTION 'Your response has already been submitted.';
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

REVOKE EXECUTE ON FUNCTION public.get_student_feedback_form(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_feedback_draft(uuid, uuid, boolean, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_course_feedback(uuid, uuid, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_feedback_form(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_feedback_draft(uuid, uuid, boolean, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_course_feedback(uuid, uuid, boolean, jsonb) TO authenticated, service_role;
