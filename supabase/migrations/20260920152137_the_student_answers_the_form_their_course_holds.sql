-- The student answers the form their course holds.
--
-- Both of these matched "the round's questions, plus any this course added".
-- Now that a course takes its own copy of the round's template the first time
-- it is edited, that would show a student both copies. They read the course's
-- form instead: its own questions if it has them, the template if it has not.
create or replace function public.get_student_feedback_form(
  p_period_id uuid, p_course_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
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
    from public.course_form_questions(p_period_id, p_course_id) cfq
    join feedback_questions fq on fq.id = cfq.question_id
   where fq.is_active;

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
                              'display_order', cfq.display_order,
                              'depends_on_question_id', fq.depends_on_question_id,
                              'depends_on_values', fq.depends_on_values)
                            order by cfq.display_order, fq.display_order)
           ) as section
      from public.course_form_questions(p_period_id, p_course_id) cfq
      join feedback_questions fq on fq.id = cfq.question_id
     where fq.is_active
     group by fq.section_key
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', fq.id, 'question_text', fq.question_text,
           'question_type', fq.question_type, 'options', fq.options,
           'placeholder', fq.placeholder, 'category', fq.category,
           'target_type', fq.target_type, 'section_key', fq.section_key,
           'section_title', fq.section_title, 'section_order', fq.section_order,
           'is_required', fq.is_required, 'display_order', cfq.display_order,
           'depends_on_question_id', fq.depends_on_question_id,
           'depends_on_values', fq.depends_on_values)
         order by fq.section_order, cfq.display_order), '[]'::jsonb)
    into v_questions
    from public.course_form_questions(p_period_id, p_course_id) cfq
    join feedback_questions fq on fq.id = cfq.question_id
   where fq.is_active;

  select jsonb_build_object(
    'id', fs.id, 'status', fs.status, 'is_anonymous', fs.is_anonymous,
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_id', fa.question_id,
        'lecturer_target_id', fa.lecturer_target_id,
        'rating_value', fa.rating_value,
        'text_value', fa.text_value,
        'choice_value', fa.choice_value,
        'choice_values', fa.choice_values))
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
    'can_edit', v_can_edit,
    'submission', v_submission
  );
end;
$$;

create or replace function public.missing_required_feedback(
  p_period_id uuid, p_offering_id uuid, p_answers jsonb
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with this_course as (
    select course_id from public.course_offerings where id = p_offering_id
  ),
  period_q as (
    select fq.id, fq.question_type, fq.target_type, fq.is_required,
           fq.depends_on_question_id, fq.depends_on_values
      from public.course_form_questions(
             p_period_id, (select course_id from this_course)) cfq
      join public.feedback_questions fq on fq.id = cfq.question_id
     where fq.is_active and fq.is_required
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

-- The coordinator's older screen lists the questions a course added; with a
-- copy taken, that is every question the course holds.
create or replace function public.get_my_coordinated_feedback()
returns table (
  period_id uuid, period_title text, period_status text, feedback_type text,
  opens_at timestamptz, closes_at timestamptz, course_id uuid,
  course_code text, course_title text, response_count integer,
  can_edit_questions boolean, my_questions jsonb
)
language plpgsql
stable
security definer
set search_path = public
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
         p.status = 'draft',
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