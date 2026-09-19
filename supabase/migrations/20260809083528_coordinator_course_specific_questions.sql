-- coordinator_course_specific_questions
-- Applied 20260809083528
-- Exported from the live project; do not edit by hand.

-- A course coordinator can ask their own students something the faculty form
-- does not — about a project, a lab, a guest lecture. The question belongs to
-- their course alone, so it is attached with course_id set and nobody else's
-- students ever see it.
--
-- Coordinator questions land in their own section after the standard ones, so
-- the faculty's form is never rearranged by them. Other Comments moves last to
-- keep the free-text close at the end.

update public.feedback_questions
   set section_order = 10 where section_key = 'other_comments';

-- ---------------------------------------------------------------------
-- Reads: a question with a course_id is asked on that course only
-- ---------------------------------------------------------------------
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
  v_coordinator text;
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'lecturer_id', l.id,
           'name', coalesce(l.title || ' ', '') || l.name,
           'assignment_role', cl.assignment_role)
         order by cl.assignment_role desc, l.name), '[]'::jsonb)
    into v_lecturers
    from course_lecturers cl
    join lecturers l on l.id = cl.lecturer_id
   where cl.offering_id = v_offering and cl.is_active;

  select coalesce(l.title || ' ', '') || l.name into v_coordinator
    from course_lecturers cl
    join lecturers l on l.id = cl.lecturer_id
   where cl.offering_id = v_offering and cl.is_active
     and cl.assignment_role = 'coordinator'
   limit 1;

  select count(*) into v_question_count
    from feedback_period_questions fpq
    join feedback_questions fq on fq.id = fpq.question_id
   where fpq.feedback_period_id = p_period_id and fq.is_active
     and (fpq.course_id is null or fpq.course_id = p_course_id);

  if v_question_count = 0 then
    return jsonb_build_object('error', 'no_questions', 'course', v_course);
  end if;

  select jsonb_agg(section order by section_order, section_key)
    into v_sections
  from (
    select fq.section_key                        as section_key,
           min(fq.section_order)                 as section_order,
           jsonb_build_object(
             'key',         fq.section_key,
             'title',       coalesce(min(fq.section_title), 'Questions'),
             'description', min(fq.section_description),
             'icon',        min(fq.section_icon),
             'target_type', min(fq.target_type),
             'questions',   jsonb_agg(jsonb_build_object(
                              'id', fq.id,
                              'question_text', fq.question_text,
                              'question_type', fq.question_type,
                              'options', fq.options,
                              'placeholder', fq.placeholder,
                              'is_required', fq.is_required,
                              'display_order', fpq.display_order,
                              'depends_on_question_id', fq.depends_on_question_id,
                              'depends_on_values', fq.depends_on_values)
                            order by fpq.display_order, fq.display_order)
           ) as section
      from feedback_period_questions fpq
      join feedback_questions fq on fq.id = fpq.question_id
     where fpq.feedback_period_id = p_period_id and fq.is_active
       and (fpq.course_id is null or fpq.course_id = p_course_id)
     group by fq.section_key
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', fq.id, 'question_text', fq.question_text,
           'question_type', fq.question_type, 'options', fq.options,
           'placeholder', fq.placeholder, 'category', fq.category,
           'target_type', fq.target_type, 'section_key', fq.section_key,
           'section_title', fq.section_title, 'section_order', fq.section_order,
           'is_required', fq.is_required, 'display_order', fpq.display_order,
           'depends_on_question_id', fq.depends_on_question_id,
           'depends_on_values', fq.depends_on_values)
         order by fq.section_order, fpq.display_order), '[]'::jsonb)
    into v_questions
    from feedback_period_questions fpq
    join feedback_questions fq on fq.id = fpq.question_id
   where fpq.feedback_period_id = p_period_id and fq.is_active
     and (fpq.course_id is null or fpq.course_id = p_course_id);

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
    'coordinator_name', v_coordinator,
    'academic_year', v_period.academic_year,
    'period_title', v_period.title,
    'closes_at', v_period.closes_at,
    'sections', coalesce(v_sections, '[]'::jsonb),
    'questions', v_questions,
    'feedback_type', v_period.feedback_type,
    'period_open', v_open,
    'allow_editing', v_period.allow_editing,
    'can_edit', v_can_edit
  );
end;
$$;

/** Required answers still owed. Course-scoped questions count only for the
 *  course they belong to, or a student on a different course in the same round
 *  could never satisfy them. */
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
  with this_course as (
    select course_id from public.course_offerings where id = p_offering_id
  ),
  period_q as (
    select fq.id, fq.question_type, fq.target_type, fq.is_required,
           fq.depends_on_question_id, fq.depends_on_values
      from public.feedback_period_questions fpq
      join public.feedback_questions fq on fq.id = fpq.question_id
     where fpq.feedback_period_id = p_period_id and fq.is_active and fq.is_required
       and (fpq.course_id is null
            or fpq.course_id = (select course_id from this_course))
  ),
  lect as (
    select cl.lecturer_id from public.course_lecturers cl
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

-- ---------------------------------------------------------------------
-- What a coordinator may add
-- ---------------------------------------------------------------------
/** The offering this caller coordinates for a course in a period, or null. */
create or replace function public.my_coordinated_offering(
  p_period_id uuid,
  p_course_id uuid
)
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_lecturer uuid := public.my_lecturer_id();
  v_offering uuid;
begin
  if v_lecturer is null then return null; end if;

  select o.id into v_offering
    from public.course_offerings o
    join public.feedback_periods p on p.id = p_period_id
    join public.course_lecturers cl
      on cl.offering_id = o.id and cl.is_active
     and cl.lecturer_id = v_lecturer
     and cl.assignment_role = 'coordinator'
   where o.course_id = p_course_id
     and (p.batch_year is null or o.batch_year = p.batch_year)
   order by o.batch_year desc
   limit 1;

  return v_offering;
end;
$$;

/** Add a question asked only of this course's students.
 *
 *  A question added once answers exist cannot be required: an earlier
 *  submission was complete when it was made, and making it retrospectively
 *  incomplete is not something a later edit gets to do. */
create or replace function public.add_course_feedback_question(
  p_period_id     uuid,
  p_course_id     uuid,
  p_question_text text,
  p_question_type text default 'rating',
  p_options       jsonb default null,
  p_placeholder   text default null,
  p_is_required   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_offering  uuid;
  v_question  uuid;
  v_responses int;
  v_required  boolean;
  v_order     int;
begin
  v_offering := public.my_coordinated_offering(p_period_id, p_course_id);
  if v_offering is null then
    raise exception 'Only this course''s coordinator can add a question to it';
  end if;

  if coalesce(btrim(p_question_text), '') = '' then
    raise exception 'Give the question some text';
  end if;
  if p_question_type not in ('rating','yes_no','single_choice','short_text','long_text') then
    raise exception 'That is not a question type this form supports';
  end if;

  select count(*) into v_responses
    from public.feedback_submissions fs
   where fs.feedback_period_id = p_period_id
     and fs.course_id = p_course_id
     and fs.status = 'submitted';

  v_required := p_is_required and v_responses = 0;

  select coalesce(max(fpq.display_order), 900) + 1 into v_order
    from public.feedback_period_questions fpq
   where fpq.feedback_period_id = p_period_id and fpq.course_id = p_course_id;

  insert into public.feedback_questions (
    question_text, question_type, target_type, options, placeholder,
    section_key, section_title, section_description, section_icon, section_order,
    is_required, display_order, category, created_by
  ) values (
    btrim(p_question_text), p_question_type, 'course',
    case when p_question_type = 'single_choice' then p_options else null end,
    p_placeholder,
    'course_specific', 'Course-Specific Questions',
    'Added by your course coordinator', '➕', 9,
    v_required, v_order, 'Course-Specific', auth.uid()
  ) returning id into v_question;

  insert into public.feedback_period_questions (feedback_period_id, question_id, course_id, display_order)
  values (p_period_id, v_question, p_course_id, v_order);

  return jsonb_build_object('ok', true, 'question_id', v_question,
    'message', case when p_is_required and not v_required
      then 'Added. It is optional, because students have already answered this form.'
      else 'Added. Your students will see it on this course only.' end);
end;
$$;

/** Remove a question the caller added to their own course. Detached rather
 *  than deleted once it has answers — those answers point at it. */
create or replace function public.remove_course_feedback_question(
  p_period_id uuid,
  p_course_id uuid,
  p_question_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_answers int;
begin
  if public.my_coordinated_offering(p_period_id, p_course_id) is null then
    raise exception 'Only this course''s coordinator can change its questions';
  end if;

  if not exists (
    select 1 from public.feedback_questions
     where id = p_question_id and created_by = auth.uid()
       and section_key = 'course_specific'
  ) then
    raise exception 'That question is not one you added';
  end if;

  delete from public.feedback_period_questions
   where feedback_period_id = p_period_id
     and course_id = p_course_id
     and question_id = p_question_id;

  select count(*) into v_answers
    from public.feedback_answers where question_id = p_question_id;

  if v_answers = 0 then
    delete from public.feedback_questions where id = p_question_id;
    return jsonb_build_object('ok', true, 'message', 'Question removed.');
  end if;

  update public.feedback_questions set is_active = false where id = p_question_id;
  return jsonb_build_object('ok', true,
    'message', format('Question removed from the form. %s answer(s) already given are kept.', v_answers));
end;
$$;

/** The rounds currently covering a course the caller coordinates, with the
 *  questions they have added to each. */
create or replace function public.get_my_coordinated_feedback()
returns table (
  period_id     uuid,
  period_title  text,
  period_status text,
  feedback_type text,
  opens_at      timestamptz,
  closes_at     timestamptz,
  course_id     uuid,
  course_code   text,
  course_title  text,
  response_count integer,
  my_questions  jsonb
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_lecturer uuid := public.my_lecturer_id();
begin
  if v_lecturer is null then return; end if;

  return query
  select p.id, p.title, p.status, p.feedback_type, p.opens_at, p.closes_at,
         c.id, c.course_code, c.title,
         (select count(*)::int from public.feedback_submissions fs
           where fs.feedback_period_id = p.id and fs.course_id = c.id
             and fs.status = 'submitted'),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', fq.id, 'question_text', fq.question_text,
                    'question_type', fq.question_type, 'options', fq.options,
                    'placeholder', fq.placeholder, 'is_required', fq.is_required)
                  order by fpq.display_order)
             from public.feedback_period_questions fpq
             join public.feedback_questions fq on fq.id = fpq.question_id
            where fpq.feedback_period_id = p.id and fpq.course_id = c.id
              and fq.is_active), '[]'::jsonb)
    from public.feedback_periods p
    join public.feedback_period_courses fpc on fpc.feedback_period_id = p.id
    join public.courses c on c.id = fpc.course_id
    join public.course_offerings o on o.course_id = c.id
                                  and (p.batch_year is null or o.batch_year = p.batch_year)
    join public.course_lecturers cl on cl.offering_id = o.id and cl.is_active
                                   and cl.lecturer_id = v_lecturer
                                   and cl.assignment_role = 'coordinator'
   where p.status <> 'archived'
   order by p.opens_at desc, c.course_code;
end;
$$;

revoke execute on function public.my_coordinated_offering(uuid, uuid) from public, anon;
revoke execute on function public.add_course_feedback_question(uuid, uuid, text, text, jsonb, text, boolean) from public, anon;
revoke execute on function public.remove_course_feedback_question(uuid, uuid, uuid) from public, anon;
revoke execute on function public.get_my_coordinated_feedback() from public, anon;
grant  execute on function public.my_coordinated_offering(uuid, uuid) to authenticated;
grant  execute on function public.add_course_feedback_question(uuid, uuid, text, text, jsonb, text, boolean) to authenticated;
grant  execute on function public.remove_course_feedback_question(uuid, uuid, uuid) to authenticated;
grant  execute on function public.get_my_coordinated_feedback() to authenticated;
