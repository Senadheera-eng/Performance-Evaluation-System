-- add_medical_review_rpcs
-- Applied 20260726145551
-- Exported from the live project; do not edit by hand.

-- review_medical_submission_course: the single, atomic entry point for
-- deciding one course item within a medical submission. Runs as
-- SECURITY DEFINER because no RLS policy grants a dept_admin direct
-- UPDATE on medical_submission_courses (intentional — see prior
-- migration) or on medical_submissions/attendance across departments;
-- this function is the only sanctioned path, so every decision is
-- centrally authorised, recomputes the parent's derived status, and
-- atomically excuses matching attendance in the same transaction.
CREATE OR REPLACE FUNCTION public.review_medical_submission_course(
  p_msc_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := get_my_role();
  v_dept text := get_my_department();
  v_msc record;
  v_course_dept text;
  v_sub record;
  v_new_notes text;
  v_updated_count int := 0;
  v_existing_count int := 0;
  v_overall text;
  v_message text;
BEGIN
  IF v_role NOT IN ('dept_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid decision: must be approved or rejected';
  END IF;

  SELECT msc.*, c.department AS live_course_dept
    INTO v_msc
  FROM medical_submission_courses msc
  JOIN courses c ON c.id = msc.course_id
  WHERE msc.id = p_msc_id
  FOR UPDATE;

  IF v_msc IS NULL THEN
    RAISE EXCEPTION 'Course item not found';
  END IF;
  v_course_dept := v_msc.live_course_dept;

  IF v_role <> 'super_admin' AND v_course_dept IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'Access denied: you are not authorised to review this course';
  END IF;

  IF v_msc.review_status <> 'pending' AND v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'This course item has already been reviewed';
  END IF;

  v_new_notes := p_notes;
  IF v_msc.review_status <> 'pending' AND v_role = 'super_admin' THEN
    -- Reversal path: restricted to super_admin, and audited by recording
    -- what the prior decision was rather than silently overwriting it.
    v_new_notes := '[Reversed by super_admin from "' || v_msc.review_status
      || '" on ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ']  '
      || COALESCE(p_notes, '');
  END IF;

  UPDATE medical_submission_courses
  SET review_status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = v_new_notes
  WHERE id = p_msc_id;

  SELECT * INTO v_sub FROM medical_submissions WHERE id = v_msc.submission_id;

  -- Derive the parent's overall status from every course item's status.
  SELECT
    CASE
      WHEN count(*) FILTER (WHERE review_status = 'approved') = count(*) THEN 'approved'
      WHEN count(*) FILTER (WHERE review_status = 'rejected') = count(*) THEN 'rejected'
      WHEN count(*) FILTER (WHERE review_status = 'pending') = count(*) THEN 'pending'
      WHEN count(*) FILTER (WHERE review_status = 'approved') > 0
           AND count(*) FILTER (WHERE review_status = 'rejected') > 0 THEN 'mixed'
      ELSE 'partially_approved'
    END
  INTO v_overall
  FROM medical_submission_courses WHERE submission_id = v_msc.submission_id;

  UPDATE medical_submissions SET status = v_overall WHERE id = v_msc.submission_id;

  IF p_decision = 'approved' THEN
    SELECT count(*) INTO v_existing_count FROM attendance
    WHERE student_id = v_sub.student_id AND course_id = v_msc.course_id
      AND lecture_date BETWEEN v_sub.missed_date AND COALESCE(v_sub.end_date, v_sub.missed_date);

    UPDATE attendance
    SET status = 'excused', excused_via_submission_id = v_sub.id
    WHERE student_id = v_sub.student_id AND course_id = v_msc.course_id
      AND lecture_date BETWEEN v_sub.missed_date AND COALESCE(v_sub.end_date, v_sub.missed_date)
      AND status = 'absent';
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_existing_count = 0 THEN
      v_message := 'The request was approved, but no attendance records currently exist for the selected dates.';
    ELSIF v_updated_count = 0 THEN
      v_message := 'The medical request was approved. No matching absent attendance records needed updating.';
    ELSE
      v_message := 'The medical request was approved and matching attendance records were marked as excused.';
    END IF;
  ELSE
    v_message := 'The course item was rejected. Attendance records were not changed.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'decision', p_decision,
    'overall_status', v_overall,
    'attendance_updated_count', v_updated_count,
    'attendance_existing_count', v_existing_count,
    'message', v_message
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.review_medical_submission_course(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_medical_submission_course(uuid, text, text) TO authenticated, service_role;

-- get_admin_medical_submissions: everything an admin's Medical page needs
-- in one call — sidesteps the ambiguous-relationship error PostgREST
-- throws when embedding `students` on medical_submissions directly
-- (there are two FKs to students: student_id and reviewed_by), and
-- returns course items already scoped to the caller's own department
-- (or all departments for super_admin), plus a same-submission count of
-- still-pending items from OTHER departments so the UI can say "N item(s)
-- awaiting another department's review" without exposing which course or
-- department those are.
CREATE OR REPLACE FUNCTION public.get_admin_medical_submissions()
RETURNS TABLE (
  id uuid,
  student_id uuid,
  student_name text,
  student_reg_number text,
  student_index_number text,
  student_batch_year integer,
  student_department text,
  reason_type text,
  missed_date date,
  end_date date,
  description text,
  submitted_at timestamptz,
  overall_status text,
  my_items jsonb,
  other_departments_pending_count integer,
  files jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := get_my_role();
  v_dept text := get_my_department();
BEGIN
  IF v_role NOT IN ('dept_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    m.id, m.student_id, s.name, s.reg_number, s.index_number, s.batch_year, s.department,
    m.reason_type, m.missed_date, m.end_date, m.description, m.submitted_at, m.status,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'msc_id', msc.id,
        'course_id', msc.course_id,
        'course_code', c.course_code,
        'course_title', c.title,
        'department', msc.department,
        'review_status', msc.review_status,
        'reviewed_by', msc.reviewed_by,
        'reviewed_at', msc.reviewed_at,
        'review_notes', msc.review_notes
      ) ORDER BY c.course_code)
      FROM medical_submission_courses msc
      JOIN courses c ON c.id = msc.course_id
      WHERE msc.submission_id = m.id
        AND (v_role = 'super_admin' OR msc.department = v_dept)
    ) AS my_items,
    (
      SELECT count(*)::int FROM medical_submission_courses msc2
      WHERE msc2.submission_id = m.id
        AND v_role <> 'super_admin'
        AND msc2.department <> v_dept
        AND msc2.review_status = 'pending'
    ) AS other_departments_pending_count,
    (
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'file_url', f.file_url, 'file_name', f.file_name))
      FROM medical_submission_files f WHERE f.submission_id = m.id
    ) AS files
  FROM medical_submissions m
  JOIN students s ON s.id = m.student_id
  WHERE
    v_role = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM medical_submission_courses msc3
      WHERE msc3.submission_id = m.id AND msc3.department = v_dept
    )
  ORDER BY m.submitted_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_medical_submissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_medical_submissions() TO authenticated, service_role;
