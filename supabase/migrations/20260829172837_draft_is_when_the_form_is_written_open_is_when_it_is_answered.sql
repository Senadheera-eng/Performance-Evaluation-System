-- draft_is_when_the_form_is_written_open_is_when_it_is_answered
-- Applied 20260829172837
-- Exported from the live project; do not edit by hand.

-- Draft is when the form is written. Open is when it is answered.
--
-- A coordinator could add a question to their course at any point in a
-- period's life, including halfway through the answering. The function knew
-- this was wrong and worked around it -- a question added after the first
-- submission was quietly forced to optional, because the students who had
-- already finished were never going to see it. That is a form which means
-- something different depending on when you filled it in.
--
-- The workflow now says plainly where the seam is. A department admin creates
-- the period as a draft; while it is a draft the coordinators shape their own
-- courses' questions; the admin opens it and the form is fixed for everyone
-- who answers it. So both write paths ask for draft, and the optional-because-
-- too-late dance goes away with the case that produced it.

create or replace function public.add_course_feedback_question(
  p_period_id uuid, p_course_id uuid, p_question_text text,
  p_question_type text default 'rating',
  p_options jsonb default null, p_placeholder text default null,
  p_is_required boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_status   text;
  v_question uuid;
  v_order    int;
begin
  if public.my_coordinated_offering(p_period_id, p_course_id) is null then
    raise exception 'Only this course''s coordinator can add a question to it';
  end if;

  select status into v_status from public.feedback_periods where id = p_period_id;
  if v_status is distinct from 'draft' then
    raise exception 'This feedback form is already %. Questions can only be added while it is a draft.',
      coalesce(v_status, 'gone');
  end if;

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

  select coalesce(max(fpq.display_order), 900) + 1 into v_order
    from public.feedback_period_questions fpq
   where fpq.feedback_period_id = p_period_id and fpq.course_id = p_course_id;

  insert into public.feedback_questions (
    question_text, question_type, target_type, options, placeholder,
    section_key, section_title, section_description, section_icon, section_order,
    is_required, display_order, category, created_by
  ) values (
    btrim(p_question_text), p_question_type, 'course',
    case when p_question_type in ('single_choice','multi_select')
         then p_options else null end,
    p_placeholder,
    'course_specific', 'Course-Specific Questions',
    'Added by your course coordinator', '➕', 9,
    p_is_required, v_order, 'Course-Specific', auth.uid()
  ) returning id into v_question;

  insert into public.feedback_period_questions
    (feedback_period_id, question_id, course_id, display_order)
  values (p_period_id, v_question, p_course_id, v_order);

  return jsonb_build_object('ok', true, 'question_id', v_question,
    'message', 'Added. Your students will see it on this course only.');
end;
$$;

grant execute on function public.add_course_feedback_question(uuid,uuid,text,text,jsonb,text,boolean)
  to authenticated;

create or replace function public.remove_course_feedback_question(
  p_period_id uuid, p_course_id uuid, p_question_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_status text;
begin
  if public.my_coordinated_offering(p_period_id, p_course_id) is null then
    raise exception 'Only this course''s coordinator can change its questions';
  end if;

  select status into v_status from public.feedback_periods where id = p_period_id;
  if v_status is distinct from 'draft' then
    raise exception 'This feedback form is already %. Questions can only be changed while it is a draft.',
      coalesce(v_status, 'gone');
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

  -- Nothing can have been answered in a draft, so the question goes for good
  -- rather than being kept alive to hang answers off.
  delete from public.feedback_questions where id = p_question_id;

  return jsonb_build_object('ok', true, 'message', 'Question removed.');
end;
$$;

grant execute on function public.remove_course_feedback_question(uuid,uuid,uuid) to authenticated;

-- The coordinator's list says whether the form is still theirs to shape, so
-- the page can show the editor or explain why it is gone.
drop function if exists public.get_my_coordinated_feedback();

create function public.get_my_coordinated_feedback()
returns table(
  period_id uuid, period_title text, period_status text, feedback_type text,
  opens_at timestamp with time zone, closes_at timestamp with time zone,
  course_id uuid, course_code text, course_title text,
  response_count integer, can_edit_questions boolean, my_questions jsonb)
language plpgsql stable security definer set search_path to 'public'
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

grant execute on function public.get_my_coordinated_feedback() to authenticated;
