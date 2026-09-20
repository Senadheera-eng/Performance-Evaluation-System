-- The section title varies by row within a section key only in principle;
-- grouping by the key alone means every other column has to be aggregated.
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
    'can_edit', v_period.status = 'draft',
    'sections', v_sections);
end;
$$;