-- Editing a section, not just adding one.
--
-- A section had no way to be renamed or described after it was made: the
-- title was whatever was typed with its first question. Two kinds of section
-- sit on a form, and they are owned by different people:
--
--   * The course's own — added by whoever teaches it. Theirs to rename,
--     describe, fill and empty.
--   * The department's — the questions every course in the round is asked.
--     One lecturer renaming one of those would rewrite the form of every
--     other course in the round, so those belong to whoever owns the round:
--     the department's admin, a super admin, or the sitting head.
--
-- Both only while the round is a draft. Once it opens, every student has to
-- be answering the same questions.
create or replace function public.may_manage_round_form(p_period_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_department text;
begin
  select p.department into v_department
    from public.feedback_periods p where p.id = p_period_id;

  return coalesce(public.get_my_role(), '') = 'super_admin'
      or (coalesce(public.get_my_role(), '') = 'dept_admin'
          and v_department is not null
          and public.get_my_department() = v_department)
      or (v_department is not null and public.is_active_hod_of(v_department));
end;
$$;
revoke all on function public.may_manage_round_form(uuid) from public, anon;
grant execute on function public.may_manage_round_form(uuid) to authenticated;

-- Rename a section, or give it a description.
create or replace function public.save_form_section(
  p_period_id uuid,
  p_course_id uuid,
  p_section_key text,
  p_title text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_shared   boolean;
  v_new_key  text;
  v_count    int;
begin
  select status into v_status from public.feedback_periods where id = p_period_id;
  if v_status is distinct from 'draft' then
    raise exception 'This form is already %. It can only be changed while the round is a draft.',
      coalesce(v_status, 'gone');
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Give the section a title';
  end if;

  -- Whose section is it? Shared when its questions hang off the round
  -- rather than off this course.
  select bool_and(fpq.course_id is null) into v_shared
    from public.feedback_period_questions fpq
    join public.feedback_questions fq on fq.id = fpq.question_id
   where fpq.feedback_period_id = p_period_id
     and coalesce(fq.section_key, 'general') = p_section_key
     and (fpq.course_id is null or fpq.course_id = p_course_id);

  if v_shared is null then
    raise exception 'No such section on this form';
  end if;

  if v_shared then
    if not public.may_manage_round_form(p_period_id) then
      raise exception 'This section is asked of every course in the round, so only your department can change it';
    end if;
  else
    perform public.assert_can_edit_course_form(p_period_id, p_course_id);
  end if;

  v_new_key := case when v_shared then p_section_key
                    else 'course_' || regexp_replace(lower(btrim(p_title)),
                                                     '[^a-z0-9]+', '_', 'g') end;

  update public.feedback_questions fq
     set section_title = btrim(p_title),
         section_description = nullif(btrim(coalesce(p_description, '')), ''),
         section_key = v_new_key,
         updated_at = now()
    from public.feedback_period_questions fpq
   where fpq.question_id = fq.id
     and fpq.feedback_period_id = p_period_id
     and coalesce(fq.section_key, 'general') = p_section_key
     and (case when v_shared then fpq.course_id is null
               else fpq.course_id = p_course_id end);
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'questions_updated', v_count,
    'message', case when v_shared
      then format('Section saved. It is asked of every course in this round.')
      else 'Section saved.' end);
end;
$$;
revoke all on function public.save_form_section(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.save_form_section(uuid, uuid, text, text, text) to authenticated;

-- Editing and removing a question now covers the department's own questions
-- too, for whoever owns the round. A lecturer is still held to their course.
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
  v_shared boolean := false;
  v_status text;
begin
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

  if v_question is not null then
    select fpq.course_id is null into v_shared
      from public.feedback_period_questions fpq
     where fpq.feedback_period_id = p_period_id
       and fpq.question_id = v_question
       and (fpq.course_id is null or fpq.course_id = p_course_id)
     limit 1;
    if v_shared is null then
      raise exception 'That question is not on this form';
    end if;
  end if;

  if v_shared then
    select status into v_status from public.feedback_periods where id = p_period_id;
    if v_status is distinct from 'draft' then
      raise exception 'This form is already %. It can only be changed while the round is a draft.',
        coalesce(v_status, 'gone');
    end if;
    if not public.may_manage_round_form(p_period_id) then
      raise exception 'This question is asked of every course in the round, so only your department can change it';
    end if;
  else
    perform public.assert_can_edit_course_form(p_period_id, p_course_id);
  end if;

  /* A shared question keeps the section it is in; a course's own is keyed
     off its title so two questions written into the same section land
     together. */
  v_section_key := case when v_shared
    then (select coalesce(section_key, 'general') from public.feedback_questions where id = v_question)
    else 'course_' || regexp_replace(lower(coalesce(nullif(btrim(p_section_title), ''),
                                                    'Course-Specific Questions')),
                                     '[^a-z0-9]+', '_', 'g') end;

  if v_question is not null then
    update public.feedback_questions
       set question_text = btrim(p_question_text),
           question_type = p_question_type,
           options = case when p_question_type in ('single_choice','multi_select')
                          then p_options else null end,
           placeholder = p_placeholder,
           is_required = coalesce(p_is_required, false),
           section_key = v_section_key,
           section_title = case when v_shared then section_title
                                else coalesce(nullif(btrim(p_section_title), ''),
                                              'Course-Specific Questions') end,
           section_order = case when v_shared then section_order
                                else coalesce(p_section_order, 9) end,
           display_order = v_order,
           updated_at = now()
     where id = v_question;

    update public.feedback_period_questions
       set display_order = v_order
     where feedback_period_id = p_period_id
       and question_id = v_question
       and (case when v_shared then course_id is null else course_id = p_course_id end);

    return jsonb_build_object('ok', true, 'question_id', v_question,
      'message', case when v_shared
        then 'Question saved for every course in this round.'
        else 'Question saved.' end);
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

create or replace function public.remove_course_feedback_question(
  p_period_id uuid, p_course_id uuid, p_question_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shared boolean;
  v_status text;
begin
  select fpq.course_id is null into v_shared
    from public.feedback_period_questions fpq
   where fpq.feedback_period_id = p_period_id
     and fpq.question_id = p_question_id
     and (fpq.course_id is null or fpq.course_id = p_course_id)
   limit 1;
  if v_shared is null then
    raise exception 'That question is not on this form';
  end if;

  if v_shared then
    select status into v_status from public.feedback_periods where id = p_period_id;
    if v_status is distinct from 'draft' then
      raise exception 'This form is already %. It can only be changed while the round is a draft.',
        coalesce(v_status, 'gone');
    end if;
    if not public.may_manage_round_form(p_period_id) then
      raise exception 'This question is asked of every course in the round, so only your department can remove it';
    end if;
  else
    perform public.assert_can_edit_course_form(p_period_id, p_course_id);
  end if;

  delete from public.feedback_period_questions
   where feedback_period_id = p_period_id
     and question_id = p_question_id
     and (case when v_shared then course_id is null else course_id = p_course_id end);

  /* Nothing can have been answered in a draft, so a question the course
     added goes for good. One of the department's is only taken off this
     round — it belongs to the bank, and other rounds may still use it. */
  if not v_shared then
    delete from public.feedback_questions where id = p_question_id;
  end if;

  return jsonb_build_object('ok', true,
    'message', case when v_shared
      then 'Removed from this round, for every course in it.'
      else 'Question removed.' end);
end;
$$;

-- The editor needs to know what this person may change, section by section.
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
  v_manages boolean;
  v_draft   boolean;
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

  v_manages := public.may_manage_round_form(p_period_id);
  v_draft := v_period.status = 'draft';

  select coalesce(jsonb_agg(s order by (s->>'section_order')::int, s->>'title'), '[]'::jsonb)
    into v_sections
    from (
      select jsonb_build_object(
               'section_key',   coalesce(fq.section_key, 'general'),
               'title',         min(coalesce(fq.section_title, 'General')),
               'description',   min(fq.section_description),
               'icon',          min(fq.section_icon),
               'section_order', coalesce(min(fq.section_order), 0),
               'target_type',   min(fq.target_type),
               'mine',          bool_and(fpq.course_id is not null),
               -- Editable when it is this course's own, or when this person
               -- owns the round's shared form.
               'can_edit',      v_draft and (bool_and(fpq.course_id is not null) or v_manages),
               'questions',     jsonb_agg(jsonb_build_object(
                                  'id', fq.id,
                                  'question_text', fq.question_text,
                                  'question_type', fq.question_type,
                                  'options', fq.options,
                                  'placeholder', fq.placeholder,
                                  'is_required', fq.is_required,
                                  'target_type', fq.target_type,
                                  'display_order', fpq.display_order,
                                  'mine', fpq.course_id is not null,
                                  'can_edit', v_draft and (fpq.course_id is not null or v_manages))
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
    'can_edit', v_draft,
    -- True for the department's own people: the shared questions are theirs.
    'manages_round', v_manages,
    'sections', v_sections);
end;
$$;