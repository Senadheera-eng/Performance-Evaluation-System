-- student_feedback_catalogue_and_form_presentation
-- Applied 20260809074028
-- Exported from the live project; do not edit by hand.

-- The faculty's portal opens on "pick your semester, pick your course, pick
-- mid or end semester". That is three questions the client cannot answer from
-- one period at a time: a course can be covered by a mid-semester round and an
-- end-semester round at once, and which of the two is available is exactly
-- what the student is choosing between.
--
-- One call returns the whole picture, so the client does not fan out a request
-- per period and then guess at what is missing.
create or replace function public.get_student_feedback_catalogue()
returns table (
  period_id         uuid,
  period_title      text,
  feedback_type     text,
  closes_at         timestamptz,
  allow_editing     boolean,
  course_id         uuid,
  course_code       text,
  course_title      text,
  credits           integer,
  semester          integer,
  category          text,
  department        text,
  academic_year     text,
  coordinator_name  text,
  lecturer_count    integer,
  submission_status text
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_student uuid := auth.uid();
begin
  if not exists (select 1 from public.students s where s.id = v_student) then
    return;
  end if;

  return query
  select p.id, p.title, p.feedback_type, p.closes_at, p.allow_editing,
         c.id, c.course_code, c.title, c.credits, c.semester, c.category, c.department,
         p.academic_year,
         (select coalesce(l.title || ' ', '') || l.name
            from public.course_lecturers cl
            join public.lecturers l on l.id = cl.lecturer_id
           where cl.offering_id = public.offering_for_student_course(v_student, c.id)
             and cl.is_active and cl.assignment_role = 'coordinator'
           limit 1),
         (select count(*)::int
            from public.course_lecturers cl
           where cl.offering_id = public.offering_for_student_course(v_student, c.id)
             and cl.is_active),
         coalesce((select fs.status from public.feedback_submissions fs
                    where fs.feedback_period_id = p.id
                      and fs.course_id = c.id
                      and fs.student_id = v_student), 'pending')
    from public.feedback_periods p
    join public.feedback_period_courses fpc on fpc.feedback_period_id = p.id
    join public.courses c on c.id = fpc.course_id
   where p.status = 'open'
     and now() between p.opens_at and p.closes_at
     and public.student_eligible_for_feedback(v_student, p.id, c.id)
   order by c.semester, c.course_code, p.feedback_type;
end;
$$;

/** The form itself, now carrying the wording the faculty's own form shows:
 *  the subtitle under each section heading, the prompt inside each text box,
 *  and the course header a student sees before answering anything. */
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
   where fpq.feedback_period_id = p_period_id and fq.is_active;

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
     group by fq.section_key
  ) s;

  -- The flat list the previously deployed client reads. Kept so an old tab
  -- open during a release does not break.
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
   where fpq.feedback_period_id = p_period_id and fq.is_active;

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

revoke execute on function public.get_student_feedback_catalogue() from public, anon;
grant  execute on function public.get_student_feedback_catalogue() to authenticated;
