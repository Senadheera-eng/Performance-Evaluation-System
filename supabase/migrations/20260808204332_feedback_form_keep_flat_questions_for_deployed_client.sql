-- feedback_form_keep_flat_questions_for_deployed_client
-- Applied 20260808204332
-- Exported from the live project; do not edit by hand.

-- The deployed student form reads `questions`, a flat ordered array. The
-- rewrite returned only `sections`, which would have blanked the live
-- feedback form the moment it shipped — a regression introduced by this
-- work, not by the client.
--
-- `questions` is restored alongside `sections` in exactly its previous
-- shape. The two are views of the same set: old clients keep working, new
-- ones use sections for grouping, and neither has to know about the other.
-- It can be dropped once no deployed build reads it.

create or replace function public.get_student_feedback_form(
  p_period_id uuid,
  p_course_id uuid
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_student_id uuid := auth.uid();
  v_period     record;
  v_course     jsonb;
  v_offering   uuid;
  v_lecturers  jsonb;
  v_sections   jsonb;
  v_questions  jsonb;
  v_submission jsonb;
  v_open       boolean;
  v_can_edit   boolean;
begin
  select * into v_period from feedback_periods where id = p_period_id;
  if v_period is null then
    return jsonb_build_object('error', 'period_not_found');
  end if;

  if not student_eligible_for_feedback(v_student_id, p_period_id, p_course_id) then
    return jsonb_build_object('error', 'not_eligible');
  end if;

  select jsonb_build_object(
    'id', c.id, 'course_code', c.course_code, 'title', c.title,
    'credits', c.credits, 'semester', c.semester, 'category', c.category,
    'department', c.department, 'lecturer_name', c.lecturer_name
  ) into v_course
  from courses c where c.id = p_course_id;

  v_offering := offering_for_student_course(v_student_id, p_course_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'lecturer_id', l.id,
           'name', coalesce(l.title || ' ', '') || l.name,
           'assignment_role', cl.assignment_role)
         order by cl.assignment_role desc, l.name), '[]'::jsonb)
    into v_lecturers
    from course_lecturers cl
    join lecturers l on l.id = cl.lecturer_id
   where cl.offering_id = v_offering and cl.is_active;

  -- Flat list, ordered exactly as before.
  select jsonb_agg(jsonb_build_object(
           'id', fq.id,
           'question_text', fq.question_text,
           'question_type', fq.question_type,
           'category', fq.category,
           'display_order', fpq.display_order,
           'is_required', fq.is_required,
           'options', fq.options,
           'target_type', fq.target_type,
           'section_key', fq.section_key,
           'depends_on_question_id', fq.depends_on_question_id,
           'depends_on_values', fq.depends_on_values)
         order by fpq.display_order)
    into v_questions
    from feedback_period_questions fpq
    join feedback_questions fq on fq.id = fpq.question_id
   where fpq.feedback_period_id = p_period_id and fq.is_active;

  if v_questions is null or jsonb_array_length(v_questions) = 0 then
    return jsonb_build_object('error', 'no_questions', 'course', v_course);
  end if;

  select jsonb_agg(section order by section_order, section_key)
    into v_sections
  from (
    select fq.section_key,
           min(fq.section_order) as section_order,
           jsonb_build_object(
             'key',         fq.section_key,
             'title',       coalesce(min(fq.section_title), 'Questions'),
             'target_type', min(fq.target_type),
             'questions',   jsonb_agg(jsonb_build_object(
                              'id', fq.id,
                              'question_text', fq.question_text,
                              'question_type', fq.question_type,
                              'options', fq.options,
                              'is_required', fq.is_required,
                              'display_order', fpq.display_order,
                              'depends_on_question_id', fq.depends_on_question_id,
                              'depends_on_values', fq.depends_on_values)
                            order by fpq.display_order, fq.display_order)
           ) as section
      from feedback_period_questions fpq
      join feedback_questions fq on fq.id = fpq.question_id
     where fpq.feedback_period_id = p_period_id and fq.is_active
     group by fq.section_key
  ) s;

  select jsonb_build_object(
    'id', fs.id, 'status', fs.status, 'is_anonymous', fs.is_anonymous,
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_id', fa.question_id,
        'lecturer_target_id', fa.lecturer_target_id,
        'rating_value', fa.rating_value,
        'text_value', fa.text_value,
        'choice_value', fa.choice_value))
      from feedback_answers fa where fa.submission_id = fs.id
    ), '[]'::jsonb)
  ) into v_submission
  from feedback_submissions fs
  where fs.feedback_period_id = p_period_id
    and fs.course_id = p_course_id
    and fs.student_id = v_student_id;

  v_open := v_period.status = 'open'
            and now() between v_period.opens_at and v_period.closes_at;
  v_can_edit := v_open and (
    v_submission is null
    or v_submission->>'status' = 'draft'
    or v_period.allow_editing
  );

  return jsonb_build_object(
    'course', v_course,
    'offering_id', v_offering,
    'lecturers', v_lecturers,
    'questions', v_questions,
    'sections', coalesce(v_sections, '[]'::jsonb),
    'submission', v_submission,
    'feedback_type', v_period.feedback_type,
    'period_open', v_open,
    'allow_editing', v_period.allow_editing,
    'can_edit', v_can_edit
  );
end;
$$;

revoke execute on function public.get_student_feedback_form(uuid, uuid) from public, anon;
grant  execute on function public.get_student_feedback_form(uuid, uuid) to authenticated;
