-- One course's form is one course's form.
--
-- A round's questions were attached to the round, not to a course: forty-nine
-- rows with no course on them, shown on all seven or eight courses in the
-- round. That made the department's template and each course's form the same
-- rows, so renaming a section or rewording a question from one course's
-- editor changed every other lecturer's form too.
--
-- Now the round's question set is a template, and a course takes a copy of it
-- the first time anyone edits that course's form. From then on the course has
-- its own rows — its own questions, its own section titles, its own order —
-- and nothing it does can reach another course. A course nobody has edited
-- still reads the template, so a round set up and opened untouched behaves
-- exactly as before.

-- The questions on one course's form: its own if it has taken a copy, the
-- round's template if it has not.
create or replace function public.course_form_questions(
  p_period_id uuid, p_course_id uuid
)
returns table (question_id uuid, display_order integer, is_own boolean)
language sql
stable
security definer
set search_path = public
as $$
  select fpq.question_id, fpq.display_order, true
    from public.feedback_period_questions fpq
   where fpq.feedback_period_id = p_period_id
     and fpq.course_id = p_course_id
  union all
  select fpq.question_id, fpq.display_order, false
    from public.feedback_period_questions fpq
   where fpq.feedback_period_id = p_period_id
     and fpq.course_id is null
     and not exists (
       select 1 from public.feedback_period_questions own
        where own.feedback_period_id = p_period_id
          and own.course_id = p_course_id);
$$;
revoke all on function public.course_form_questions(uuid, uuid) from public, anon, authenticated;

-- Taking that copy. Every question of the template becomes a question of
-- this course, text and all, so later edits touch nobody else.
create or replace function public.fork_course_form(
  p_period_id uuid, p_course_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_copied int := 0;
begin
  if exists (select 1 from public.feedback_period_questions
              where feedback_period_id = p_period_id and course_id = p_course_id) then
    return 0;
  end if;

  with template as (
    select fpq.question_id, fpq.display_order, fq.*
      from public.feedback_period_questions fpq
      join public.feedback_questions fq on fq.id = fpq.question_id
     where fpq.feedback_period_id = p_period_id
       and fpq.course_id is null
       and fq.is_active
  ),
  copied as (
    insert into public.feedback_questions (
      question_text, question_type, target_type, options, placeholder,
      section_key, section_title, section_description, section_icon,
      section_order, is_required, display_order, category, created_by,
      depends_on_question_id, depends_on_values, is_active
    )
    select t.question_text, t.question_type, t.target_type, t.options,
           t.placeholder, t.section_key, t.section_title, t.section_description,
           t.section_icon, t.section_order, t.is_required, t.display_order,
           t.category, auth.uid(), t.depends_on_question_id, t.depends_on_values,
           true
      from template t
    returning id, question_text, section_key, display_order
  )
  insert into public.feedback_period_questions
    (feedback_period_id, question_id, course_id, display_order)
  select p_period_id, c.id, p_course_id,
         (select min(t.display_order) from template t
           where t.question_text = c.question_text
             and coalesce(t.section_key, '') = coalesce(c.section_key, ''))
    from copied c;

  get diagnostics v_copied = row_count;
  return v_copied;
end;
$$;
revoke all on function public.fork_course_form(uuid, uuid) from public, anon, authenticated;

/* Every write below: the caller must teach the course, the round must be a
   draft, and the course takes its copy before anything changes. */
create or replace function public.assert_can_edit_course_form(
  p_period_id uuid, p_course_id uuid
)
returns void
language plpgsql
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
  perform public.fork_course_form(p_period_id, p_course_id);
end;
$$;
revoke all on function public.assert_can_edit_course_form(uuid, uuid) from public, anon, authenticated;

-- Renaming or describing a section now only ever touches this course's copy.
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
  v_new_key text;
  v_count   int;
begin
  perform public.assert_can_edit_course_form(p_period_id, p_course_id);

  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Give the section a title';
  end if;

  v_new_key := 'course_' || regexp_replace(lower(btrim(p_title)), '[^a-z0-9]+', '_', 'g');

  update public.feedback_questions fq
     set section_title = btrim(p_title),
         section_description = nullif(btrim(coalesce(p_description, '')), ''),
         section_key = v_new_key,
         updated_at = now()
    from public.feedback_period_questions fpq
   where fpq.question_id = fq.id
     and fpq.feedback_period_id = p_period_id
     and fpq.course_id = p_course_id
     and coalesce(fq.section_key, 'general') = p_section_key;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'No such section on this form';
  end if;

  return jsonb_build_object('ok', true, 'questions_updated', v_count,
    'message', 'Section saved. It applies to this course only.');
end;
$$;

-- The order sections appear in, for this course alone.
create or replace function public.reorder_course_form_sections(
  p_period_id uuid, p_course_id uuid, p_section_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_i   int := 0;
begin
  perform public.assert_can_edit_course_form(p_period_id, p_course_id);

  foreach v_key in array p_section_keys loop
    v_i := v_i + 1;
    update public.feedback_questions fq
       set section_order = v_i, updated_at = now()
      from public.feedback_period_questions fpq
     where fpq.question_id = fq.id
       and fpq.feedback_period_id = p_period_id
       and fpq.course_id = p_course_id
       and coalesce(fq.section_key, 'general') = v_key;
  end loop;

  return jsonb_build_object('ok', true, 'message', 'Order saved for this course.');
end;
$$;
revoke all on function public.reorder_course_form_sections(uuid, uuid, text[]) from public, anon;
grant execute on function public.reorder_course_form_sections(uuid, uuid, text[]) to authenticated;

-- Saving a question: always this course's own copy of it.
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

  perform public.assert_can_edit_course_form(p_period_id, p_course_id);

  /* Editing one of the template's questions: after the copy above, this
     course holds its own row with the same text, so find that one. */
  if v_question is not null
     and not exists (select 1 from public.feedback_period_questions
                      where feedback_period_id = p_period_id
                        and course_id = p_course_id
                        and question_id = v_question) then
    select fpq.question_id into v_question
      from public.feedback_period_questions fpq
      join public.feedback_questions mine on mine.id = fpq.question_id
      join public.feedback_questions was on was.id = p_question_id
     where fpq.feedback_period_id = p_period_id
       and fpq.course_id = p_course_id
       and mine.question_text = was.question_text
       and coalesce(mine.section_key, '') = coalesce(was.section_key, '')
     limit 1;
    if v_question is null then
      raise exception 'That question is not on this form';
    end if;
  end if;

  v_section_key := 'course_' || regexp_replace(lower(coalesce(nullif(btrim(p_section_title), ''),
                                                              'Course-Specific Questions')),
                                               '[^a-z0-9]+', '_', 'g');

  if v_question is not null then
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
           section_order = coalesce(p_section_order, section_order),
           display_order = v_order,
           updated_at = now()
     where id = v_question;

    update public.feedback_period_questions
       set display_order = v_order
     where feedback_period_id = p_period_id
       and course_id = p_course_id
       and question_id = v_question;

    return jsonb_build_object('ok', true, 'question_id', v_question,
      'message', 'Question saved for this course.');
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
    'message', 'Added to this course''s form.');
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
  v_question uuid := p_question_id;
begin
  perform public.assert_can_edit_course_form(p_period_id, p_course_id);

  if not exists (select 1 from public.feedback_period_questions
                  where feedback_period_id = p_period_id
                    and course_id = p_course_id
                    and question_id = v_question) then
    -- It was one of the template's; this course now holds its own copy.
    select fpq.question_id into v_question
      from public.feedback_period_questions fpq
      join public.feedback_questions mine on mine.id = fpq.question_id
      join public.feedback_questions was on was.id = p_question_id
     where fpq.feedback_period_id = p_period_id
       and fpq.course_id = p_course_id
       and mine.question_text = was.question_text
       and coalesce(mine.section_key, '') = coalesce(was.section_key, '')
     limit 1;
    if v_question is null then
      raise exception 'That question is not on this form';
    end if;
  end if;

  delete from public.feedback_period_questions
   where feedback_period_id = p_period_id
     and course_id = p_course_id
     and question_id = v_question;

  -- Nothing can have been answered in a draft, and the row belonged to this
  -- course alone, so it goes for good.
  delete from public.feedback_questions where id = v_question;

  return jsonb_build_object('ok', true,
    'message', 'Removed from this course''s form.');
end;
$$;

-- What the editor shows: this course's form, whether it is still reading the
-- template or has taken its copy. Everything on it is this course's to change
-- while the round is a draft.
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
  v_draft   boolean;
  v_own     boolean;
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

  v_draft := v_period.status = 'draft';
  v_own := exists (select 1 from public.feedback_period_questions
                    where feedback_period_id = p_period_id and course_id = p_course_id);

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
               'mine',          bool_and(cfq.is_own),
               'can_edit',      v_draft,
               'questions',     jsonb_agg(jsonb_build_object(
                                  'id', fq.id,
                                  'question_text', fq.question_text,
                                  'question_type', fq.question_type,
                                  'options', fq.options,
                                  'placeholder', fq.placeholder,
                                  'is_required', fq.is_required,
                                  'target_type', fq.target_type,
                                  'display_order', cfq.display_order,
                                  'mine', cfq.is_own,
                                  'can_edit', v_draft)
                                order by cfq.display_order)
             ) as s
        from public.course_form_questions(p_period_id, p_course_id) cfq
        join public.feedback_questions fq on fq.id = cfq.question_id
       where fq.is_active
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
    -- True once this course holds its own copy rather than the template.
    'is_own_form', v_own,
    'manages_round', public.may_manage_round_form(p_period_id),
    'sections', v_sections);
end;
$$;