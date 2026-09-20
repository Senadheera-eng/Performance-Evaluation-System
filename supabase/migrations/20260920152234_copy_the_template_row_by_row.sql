-- The copy is made one question at a time.
--
-- The set-based version selected fq.* beside the link's own display_order,
-- so every reference to display_order was ambiguous and the whole copy
-- failed. Row by row also carries each question's place on the form across
-- directly, instead of matching copies back to their originals by text.
create or replace function public.fork_course_form(
  p_period_id uuid, p_course_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_new    uuid;
  v_copied int := 0;
begin
  if exists (select 1 from public.feedback_period_questions
              where feedback_period_id = p_period_id and course_id = p_course_id) then
    return 0;
  end if;

  for r in
    select fpq.display_order as link_order,
           fq.question_text, fq.question_type, fq.target_type, fq.options,
           fq.placeholder, fq.section_key, fq.section_title,
           fq.section_description, fq.section_icon, fq.section_order,
           fq.is_required, fq.display_order as own_order, fq.category,
           fq.depends_on_question_id, fq.depends_on_values
      from public.feedback_period_questions fpq
      join public.feedback_questions fq on fq.id = fpq.question_id
     where fpq.feedback_period_id = p_period_id
       and fpq.course_id is null
       and fq.is_active
     order by fq.section_order, fpq.display_order
  loop
    insert into public.feedback_questions (
      question_text, question_type, target_type, options, placeholder,
      section_key, section_title, section_description, section_icon,
      section_order, is_required, display_order, category, created_by,
      depends_on_question_id, depends_on_values, is_active
    ) values (
      r.question_text, r.question_type, r.target_type, r.options, r.placeholder,
      r.section_key, r.section_title, r.section_description, r.section_icon,
      r.section_order, r.is_required, r.own_order, r.category, auth.uid(),
      r.depends_on_question_id, r.depends_on_values, true
    ) returning id into v_new;

    insert into public.feedback_period_questions
      (feedback_period_id, question_id, course_id, display_order)
    values (p_period_id, v_new, p_course_id, r.link_order);

    v_copied := v_copied + 1;
  end loop;

  return v_copied;
end;
$$;