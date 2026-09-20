-- A lecturer shapes the form for their own course, while the round is a draft.
--
-- Until now only the course's *coordinator* could add a question, only one at
-- a time, only into a single fixed section, and only they could remove it —
-- so a co-lecturer on the same course could change nothing, and the sitting
-- head of department could change nothing at all.
--
-- The boundary that matters is the course, not the person: whoever teaches a
-- course may shape that course's form, and nobody else's. This states it once
-- and every function below reads it.
create or replace function public.my_editable_feedback_offering(
  p_period_id uuid, p_course_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lecturer uuid := public.my_lecturer_id();
  v_offering uuid;
begin
  select o.id into v_offering
    from public.course_offerings o
    join public.feedback_periods p on p.id = p_period_id
   where o.course_id = p_course_id
     and (p.batch_year is null or o.batch_year = p.batch_year)
     and (
       -- Anyone actually teaching it, coordinator or not.
       (v_lecturer is not null and exists (
          select 1 from public.course_lecturers cl
           where cl.offering_id = o.id and cl.is_active
             and cl.lecturer_id = v_lecturer))
       -- Or the sitting head of the department that delivers it.
       or public.is_active_hod_of(o.department)
     )
   order by o.batch_year desc
   limit 1;

  return v_offering;
end;
$$;
revoke all on function public.my_editable_feedback_offering(uuid, uuid) from public, anon;
grant execute on function public.my_editable_feedback_offering(uuid, uuid) to authenticated;

/* Shared by every write below: the course must be one the caller teaches,
   and the round must still be a draft. Once the department opens it, every
   student has to be answering the same questions. */
create or replace function public.assert_can_edit_course_form(
  p_period_id uuid, p_course_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if public.my_editable_feedback_offering(p_period_id, p_course_id) is null then
    raise exception 'You do not teach this course in this feedback round';
  end if;
  select status into v_status from public.feedback_periods where id = p_period_id;
  if v_status is distinct from 'draft' then
    raise exception 'This form is already %. It can only be changed while the round is a draft.',
      coalesce(v_status, 'gone');
  end if;
end;
$$;
revoke all on function public.assert_can_edit_course_form(uuid, uuid) from public, anon, authenticated;

-- The whole form for one course of one round, as the student will meet it:
-- the department's own questions, then the ones this course adds. Sections
-- carry which of the two they are, so the editor can show the first as fixed
-- and let the second be changed.
create or replace function public.get_course_form_editor(
  p_period_id uuid, p_course_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period  record;
  v_course  record;
  v_can_edit boolean;
  v_sections jsonb;
begin
  if public.my_editable_feedback_offering(p_period_id, p_course_id) is null then
    raise exception 'You do not teach this course in this feedback round';
  end if;

  select p.id, p.title, p.status, p.feedback_type, p.semester, p.batch_year,
         p.academic_year, p.opens_at, p.closes_at
    into v_period
    from public.feedback_periods p where p.id = p_period_id;

  select c.course_code, c.title into v_course
    from public.courses c where c.id = p_course_id;

  v_can_edit := v_period.status = 'draft';

  select coalesce(jsonb_agg(s order by s->>'section_order', s->>'title'), '[]'::jsonb)
    into v_sections
    from (
      select jsonb_build_object(
               'section_key',   coalesce(fq.section_key, 'general'),
               'title',         coalesce(fq.section_title, 'General'),
               'description',   min(fq.section_description),
               'icon',          min(fq.section_icon),
               'section_order', lpad(min(fq.section_order)::text, 3, '0'),
               'target_type',   min(fq.target_type),
               -- Whose section it is: the department's, or this course's own.
               'mine',          bool_and(fpq.course_id is not null),
               'questions',     jsonb_agg(jsonb_build_object(
                                  'id', fq.id,
                                  'question_text', fq.question_text,
                                  'question_type', fq.question_type,
                                  'options', fq.options,
                                  'placeholder', fq.placeholder,
                                  'is_required', fq.is_required,
                                  'target_type', fq.target_type,
                                  'display_order', fpq.display_order,
                                  'mine', fpq.course_id is not null)
                                order by fpq.display_order)
             ) as s
        from public.feedback_period_questions fpq
        join public.feedback_questions fq on fq.id = fpq.question_id
       where fpq.feedback_period_id = p_period_id
         and (fpq.course_id is null or fpq.course_id = p_course_id)
         and fq.is_active
       group by coalesce(fq.section_key, 'general')
    ) grouped;

  return jsonb_build_object(
    'period_id', v_period.id,
    'period_title', v_period.title,
    'period_status', v_period.status,
    'feedback_type', v_period.feedback_type,
    'semester', v_period.semester,
    'batch_year', v_period.batch_year,
    'academic_year', v_period.academic_year,
    'opens_at', v_period.opens_at,
    'closes_at', v_period.closes_at,
    'course_id', p_course_id,
    'course_code', v_course.course_code,
    'course_title', v_course.title,
    'can_edit', v_can_edit,
    'sections', v_sections);
end;
$$;
revoke all on function public.get_course_form_editor(uuid, uuid) from public, anon;
grant execute on function public.get_course_form_editor(uuid, uuid) to authenticated;

-- Add or change one of this course's own questions. A question the
-- department wrote is never touched here: it belongs to every course in the
-- round, so one lecturer editing it would rewrite everyone's form.
create or replace function public.save_course_form_question(
  p_period_id uuid,
  p_course_id uuid,
  p_question_id uuid,
  p_question_text text,
  p_question_type text,
  p_options jsonb,
  p_placeholder text,
  p_is_required boolean,
  p_section_title text,
  p_section_order integer,
  p_display_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question uuid := p_question_id;
  v_section_key text;
  v_order int := coalesce(p_display_order, 0);
begin
  perform public.assert_can_edit_course_form(p_period_id, p_course_id);

  if coalesce(btrim(p_question_text), '') = '' then
    raise exception 'Give the question some text';
  end if;
  if p_question_type not in ('rating','yes_no','single_choice','multi_select',
                             'short_text','long_text') then
    raise exception 'That is not a question type this form supports';
  end if;
  if p_question_type in ('single_choice','multi_select')
     and coalesce(jsonb_array_length(p_options), 0) = 0 then
    raise exception 'A choice question needs at least one option';
  end if;

  /* The section a course adds is its own, keyed off its title so two
     questions written into the same section land together. */
  v_section_key := 'course_' || regexp_replace(lower(coalesce(nullif(btrim(p_section_title), ''),
                                                              'Course-Specific Questions')),
                                               '[^a-z0-9]+', '_', 'g');

  if v_question is not null then
    -- Editing: it must already be one of this course's own questions.
    if not exists (
      select 1 from public.feedback_period_questions fpq
       where fpq.feedback_period_id = p_period_id
         and fpq.course_id = p_course_id
         and fpq.question_id = v_question
    ) then
      raise exception 'That question is not one this course added';
    end if;

    update public.feedback_questions
       set question_text = btrim(p_question_text),
           question_type = p_question_type,
           options = case when p_question_type in ('single_choice','multi_select')
                          then p_options else null end,
           placeholder = p_placeholder,
           is_required = coalesce(p_is_required, false),
           section_key = v_section_key,
           section_title = coalesce(nullif(btrim(p_section_title), ''),
                                    'Course-Specific Questions'),
           section_order = coalesce(p_section_order, 9),
           display_order = v_order,
           updated_at = now()
     where id = v_question;

    update public.feedback_period_questions
       set display_order = v_order
     where feedback_period_id = p_period_id
       and course_id = p_course_id
       and question_id = v_question;

    return jsonb_build_object('ok', true, 'question_id', v_question,
      'message', 'Question saved.');
  end if;

  insert into public.feedback_questions (
    question_text, question_type, target_type, options, placeholder,
    section_key, section_title, section_description, section_icon, section_order,
    is_required, display_order, category, created_by
  ) values (
    btrim(p_question_text), p_question_type, 'course',
    case when p_question_type in ('single_choice','multi_select')
         then p_options else null end,
    p_placeholder,
    v_section_key,
    coalesce(nullif(btrim(p_section_title), ''), 'Course-Specific Questions'),
    'Asked about this course only', '➕',
    coalesce(p_section_order, 9),
    coalesce(p_is_required, false), v_order, 'Course-Specific', auth.uid()
  ) returning id into v_question;

  insert into public.feedback_period_questions
    (feedback_period_id, question_id, course_id, display_order)
  values (p_period_id, v_question, p_course_id, v_order);

  return jsonb_build_object('ok', true, 'question_id', v_question,
    'message', 'Added. Your students will see it on this course only.');
end;
$$;
revoke all on function public.save_course_form_question(uuid,uuid,uuid,text,text,jsonb,text,boolean,text,integer,integer) from public, anon;
grant execute on function public.save_course_form_question(uuid,uuid,uuid,text,text,jsonb,text,boolean,text,integer,integer) to authenticated;

-- Removing one of this course's own questions. Ownership is by course, not
-- by who happened to type it: a co-lecturer or the head must be able to undo
-- what a colleague added to the same form.
create or replace function public.remove_course_feedback_question(
  p_period_id uuid, p_course_id uuid, p_question_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_can_edit_course_form(p_period_id, p_course_id);

  if not exists (
    select 1 from public.feedback_period_questions fpq
     where fpq.feedback_period_id = p_period_id
       and fpq.course_id = p_course_id
       and fpq.question_id = p_question_id
  ) then
    raise exception 'That question is not one this course added';
  end if;

  delete from public.feedback_period_questions
   where feedback_period_id = p_period_id
     and course_id = p_course_id
     and question_id = p_question_id;

  -- Nothing can have been answered in a draft, so the question goes for good
  -- rather than being kept alive to hang answers off.
  delete from public.feedback_questions where id = p_question_id;

  return jsonb_build_object('ok', true, 'message', 'Question removed.');
end;
$$;

-- The old single-question entry point now shares the same rule, so the
-- screen still using it keeps working and is no longer coordinator-only.
create or replace function public.add_course_feedback_question(
  p_period_id uuid, p_course_id uuid, p_question_text text,
  p_question_type text default 'rating', p_options jsonb default null,
  p_placeholder text default null, p_is_required boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order int;
begin
  perform public.assert_can_edit_course_form(p_period_id, p_course_id);

  select coalesce(max(fpq.display_order), 900) + 1 into v_order
    from public.feedback_period_questions fpq
   where fpq.feedback_period_id = p_period_id and fpq.course_id = p_course_id;

  return public.save_course_form_question(
    p_period_id, p_course_id, null, p_question_text, p_question_type,
    p_options, p_placeholder, p_is_required, 'Course-Specific Questions', 9, v_order);
end;
$$;

-- Every lecturer of a course a draft round covers, and the department's
-- head, are told when the round is set up — that draft is their window to
-- shape their own course's form, and it closes when the department opens it.
create or replace function public.notify_draft_form_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in
    select n.feedback_period_id, n.course_id, p.title, p.status, p.department,
           p.batch_year, c.course_code, c.title as course_title
      from new_rows n
      join public.feedback_periods p on p.id = n.feedback_period_id
      join public.courses c on c.id = n.course_id
     where p.status = 'draft'
  loop
    perform public.notify_users(
      (select coalesce(array_agg(distinct l.auth_user_id), '{}'::uuid[])
         from public.course_offerings o
         join public.course_lecturers cl on cl.offering_id = o.id and cl.is_active
         join public.lecturers l on l.id = cl.lecturer_id
        where o.course_id = r.course_id
          and (r.batch_year is null or o.batch_year = r.batch_year)
          and l.auth_user_id is not null),
      'feedback', 'feedback_draft_ready',
      'Set up your feedback form: ' || r.course_code,
      r.title || ' is a draft. Add your own questions to ' || r.course_code
        || ' before your department opens it.',
      '/staff/feedback', 'feedback_period', r.feedback_period_id);

    perform public.notify_user(
      public.department_head_id(coalesce(r.department,
        (select department from public.courses where id = r.course_id))),
      'feedback', 'feedback_draft_ready',
      'A feedback round is being prepared',
      r.title || ' is a draft covering ' || r.course_code || '.',
      '/staff/feedback', 'feedback_period', r.feedback_period_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists feedback_period_courses_notify on public.feedback_period_courses;
create trigger feedback_period_courses_notify
  after insert on public.feedback_period_courses
  referencing new table as new_rows
  for each statement execute function public.notify_draft_form_ready();