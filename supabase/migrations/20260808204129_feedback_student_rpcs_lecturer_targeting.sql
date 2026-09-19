-- feedback_student_rpcs_lecturer_targeting
-- Applied 20260808204129
-- Exported from the live project; do not edit by hand.

-- Student-facing feedback, rebuilt around sections, conditional questions
-- and per-lecturer targeting.
--
-- Still one submission per student per period per course. Lecturer-level
-- answers are distinguished by lecturer_target_id rather than by creating a
-- separate form per lecturer, so a course taught by three people is one
-- submission with three sets of lecturer answers — not three submissions
-- whose response rates would then triple-count the same student.

/** Whether a submitted answer counts as answered, by question type. Kept in
 *  one place so the draft path, the submit path and the form's own
 *  completeness hints cannot drift apart. */
create or replace function public.feedback_answer_provided(
  p_question_type text,
  p_answer jsonb
)
returns boolean
language sql
immutable
as $$
  select case p_question_type
    when 'rating' then coalesce(p_answer->>'rating_value', '') <> ''
    when 'single_choice' then coalesce(btrim(p_answer->>'choice_value'), '') <> ''
    when 'yes_no' then coalesce(btrim(p_answer->>'choice_value'), '') <> ''
    else coalesce(btrim(p_answer->>'text_value'), '') <> ''
  end;
$$;

/** The form a student fills in: sections in order, the lecturers actually
 *  assigned to their delivery of the course, and any answers already saved. */
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
  v_submission jsonb;
  v_open       boolean;
  v_can_edit   boolean;
  v_question_count int;
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
    'department', c.department
  ) into v_course
  from courses c where c.id = p_course_id;

  v_offering := offering_for_student_course(v_student_id, p_course_id);

  -- The lecturers to rate. Empty when nobody has been assigned yet, in which
  -- case the client simply renders no lecturer sections — better than
  -- inventing a name or asking the student to type one, which is exactly
  -- what makes the faculty's current form impossible to aggregate.
  select coalesce(jsonb_agg(jsonb_build_object(
           'lecturer_id', l.id,
           'name', coalesce(l.title || ' ', '') || l.name,
           'assignment_role', cl.assignment_role)
         order by cl.assignment_role desc, l.name), '[]'::jsonb)
    into v_lecturers
    from course_lecturers cl
    join lecturers l on l.id = cl.lecturer_id
   where cl.offering_id = v_offering and cl.is_active;

  select count(*) into v_question_count
    from feedback_period_questions fpq
    join feedback_questions fq on fq.id = fpq.question_id
   where fpq.feedback_period_id = p_period_id and fq.is_active;

  if v_question_count = 0 then
    return jsonb_build_object('error', 'no_questions', 'course', v_course);
  end if;

  select jsonb_agg(section order by section_order, section_key)
    into v_sections
  from (
    select fq.section_key                              as section_key,
           min(fq.section_order)                       as section_order,
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
    'sections', coalesce(v_sections, '[]'::jsonb),
    'submission', v_submission,
    'feedback_type', v_period.feedback_type,
    'period_open', v_open,
    'allow_editing', v_period.allow_editing,
    'can_edit', v_can_edit
  );
end;
$$;

/** Shared write path for both draft and submit. */
create or replace function public.write_feedback_answers(
  p_submission_id uuid,
  p_offering_id uuid,
  p_answers jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_answer jsonb;
  v_lecturer uuid;
  v_type text;
begin
  delete from feedback_answers where submission_id = p_submission_id;

  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
  loop
    v_lecturer := nullif(v_answer->>'lecturer_target_id', '')::uuid;

    -- A lecturer-targeted answer must name someone actually teaching this
    -- delivery. Without this a crafted request could attach ratings to any
    -- lecturer in the faculty.
    if v_lecturer is not null and not exists (
      select 1 from course_lecturers cl
       where cl.offering_id = p_offering_id
         and cl.lecturer_id = v_lecturer
         and cl.is_active
    ) then
      raise exception 'That lecturer does not teach this course offering';
    end if;

    select question_type into v_type
      from feedback_questions where id = (v_answer->>'question_id')::uuid;

    -- And a chosen option must be one the question actually offers.
    if v_type = 'single_choice'
       and coalesce(btrim(v_answer->>'choice_value'), '') <> ''
       and not exists (
         select 1 from feedback_questions fq,
                       lateral jsonb_array_elements(fq.options) o
          where fq.id = (v_answer->>'question_id')::uuid
            and o->>'value' = v_answer->>'choice_value'
       ) then
      raise exception 'That is not one of the available options for this question';
    end if;

    insert into feedback_answers
      (submission_id, question_id, lecturer_target_id, rating_value, text_value, choice_value)
    values (
      p_submission_id,
      (v_answer->>'question_id')::uuid,
      v_lecturer,
      nullif(v_answer->>'rating_value','')::int,
      nullif(v_answer->>'text_value',''),
      nullif(btrim(v_answer->>'choice_value'),'')
    );
  end loop;
end;
$$;

/** Every required answer still missing, given what has been supplied.
 *  Course questions owe one answer; lecturer questions owe one per assigned
 *  lecturer; a question whose gate is unanswered or answered the other way
 *  owes nothing. */
create or replace function public.missing_required_feedback(
  p_period_id uuid,
  p_offering_id uuid,
  p_answers jsonb
)
returns integer
language sql
stable security definer
set search_path to 'public'
as $$
  with period_q as (
    select fq.id, fq.question_type, fq.target_type, fq.is_required,
           fq.depends_on_question_id, fq.depends_on_values
      from feedback_period_questions fpq
      join feedback_questions fq on fq.id = fpq.question_id
     where fpq.feedback_period_id = p_period_id and fq.is_active and fq.is_required
  ),
  lect as (
    select cl.lecturer_id from course_lecturers cl
     where cl.offering_id = p_offering_id and cl.is_active
  ),
  obligations as (
    select q.*, null::uuid as target from period_q q where q.target_type = 'course'
    union all
    select q.*, l.lecturer_id from period_q q cross join lect l where q.target_type = 'lecturer'
  ),
  given as (
    select (a->>'question_id')::uuid as question_id,
           nullif(a->>'lecturer_target_id','')::uuid as target,
           a as answer
      from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
  )
  select count(*)::int
    from obligations o
   where
     -- the gate, if any, must be open
     (o.depends_on_question_id is null
      or exists (
        select 1 from given g
         where g.question_id = o.depends_on_question_id
           and coalesce(g.answer->>'choice_value',
                        g.answer->>'text_value',
                        g.answer->>'rating_value')
               in (select jsonb_array_elements_text(o.depends_on_values))
      ))
     and not exists (
       select 1 from given g
        where g.question_id = o.id
          and g.target is not distinct from o.target
          and public.feedback_answer_provided(o.question_type, g.answer)
     );
$$;

create or replace function public.save_feedback_draft(
  p_period_id uuid,
  p_course_id uuid,
  p_is_anonymous boolean,
  p_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_student_id uuid := auth.uid();
  v_submission_id uuid;
  v_period record;
  v_offering uuid;
begin
  select * into v_period from feedback_periods where id = p_period_id;
  if v_period is null or v_period.status <> 'open'
     or now() not between v_period.opens_at and v_period.closes_at then
    raise exception 'This feedback period is not open.';
  end if;

  if not student_eligible_for_feedback(v_student_id, p_period_id, p_course_id) then
    raise exception 'You are not eligible to give feedback for this course.';
  end if;

  v_offering := offering_for_student_course(v_student_id, p_course_id);

  insert into feedback_submissions
    (feedback_period_id, student_id, course_id, offering_id, is_anonymous, status)
  values (p_period_id, v_student_id, p_course_id, v_offering, p_is_anonymous, 'draft')
  on conflict (feedback_period_id, student_id, course_id)
  do update set is_anonymous = excluded.is_anonymous,
                offering_id  = coalesce(feedback_submissions.offering_id, excluded.offering_id),
                updated_at   = now()
  where feedback_submissions.status = 'draft'
  returning id into v_submission_id;

  if v_submission_id is null then
    raise exception 'Your response has already been submitted.';
  end if;

  perform write_feedback_answers(v_submission_id, v_offering, p_answers);
  return v_submission_id;
end;
$$;

create or replace function public.submit_course_feedback(
  p_period_id uuid,
  p_course_id uuid,
  p_is_anonymous boolean,
  p_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_student_id uuid := auth.uid();
  v_submission_id uuid;
  v_period record;
  v_offering uuid;
  v_missing int;
begin
  select * into v_period from feedback_periods where id = p_period_id;
  if v_period is null or v_period.status <> 'open'
     or now() not between v_period.opens_at and v_period.closes_at then
    raise exception 'This feedback period has already closed.';
  end if;

  if not student_eligible_for_feedback(v_student_id, p_period_id, p_course_id) then
    raise exception 'You are not eligible to submit feedback for this course.';
  end if;

  v_offering := offering_for_student_course(v_student_id, p_course_id);

  v_missing := missing_required_feedback(p_period_id, v_offering, p_answers);
  if v_missing > 0 then
    raise exception 'Please answer all required questions (% still to go).', v_missing;
  end if;

  insert into feedback_submissions
    (feedback_period_id, student_id, course_id, offering_id, is_anonymous, status, submitted_at)
  values (p_period_id, v_student_id, p_course_id, v_offering, p_is_anonymous, 'submitted', now())
  on conflict (feedback_period_id, student_id, course_id)
  do update set is_anonymous = excluded.is_anonymous,
                offering_id  = coalesce(feedback_submissions.offering_id, excluded.offering_id),
                status       = 'submitted',
                submitted_at = now(),
                updated_at   = now()
  where feedback_submissions.status = 'draft' or v_period.allow_editing
  returning id into v_submission_id;

  if v_submission_id is null then
    raise exception 'Your response has already been submitted.';
  end if;

  perform write_feedback_answers(v_submission_id, v_offering, p_answers);
  return v_submission_id;
end;
$$;

revoke execute on function public.feedback_answer_provided(text, jsonb)          from public, anon;
revoke execute on function public.write_feedback_answers(uuid, uuid, jsonb)      from public, anon, authenticated;
revoke execute on function public.missing_required_feedback(uuid, uuid, jsonb)   from public, anon;
revoke execute on function public.get_student_feedback_form(uuid, uuid)          from public, anon;
revoke execute on function public.save_feedback_draft(uuid, uuid, boolean, jsonb) from public, anon;
revoke execute on function public.submit_course_feedback(uuid, uuid, boolean, jsonb) from public, anon;
grant  execute on function public.feedback_answer_provided(text, jsonb)          to authenticated;
grant  execute on function public.missing_required_feedback(uuid, uuid, jsonb)   to authenticated;
grant  execute on function public.get_student_feedback_form(uuid, uuid)          to authenticated;
grant  execute on function public.save_feedback_draft(uuid, uuid, boolean, jsonb) to authenticated;
grant  execute on function public.submit_course_feedback(uuid, uuid, boolean, jsonb) to authenticated;
