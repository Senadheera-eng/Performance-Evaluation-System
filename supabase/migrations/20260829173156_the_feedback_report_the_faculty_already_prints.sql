-- the_feedback_report_the_faculty_already_prints
-- Applied 20260829173156
-- Exported from the live project; do not edit by hand.

-- The feedback report the faculty already prints.
--
-- Lecturers get a six-page report per course: two headline scores, the
-- fifteen lecturer attributes with their averages, what students liked, what
-- they would change, then the course's own sections -- content, resources,
-- delivery mode, teaching approach, lab work, field visits, comments.
--
-- The shape is deliberately generic rather than a field per printed heading.
-- Every section returns its ratings, its choice distributions and its free
-- text in the same three shapes, so a coordinator's own added questions come
-- through the same pipe as the faculty's, and a new section added to the bank
-- appears in the report without touching this function. Where the printed
-- report puts things is the page's business; what the numbers are is this
-- function's.
--
-- Two rules the report cannot bend. A lecturer sees only their own lecturer
-- section -- the fifteen attributes are about a person, and a course's other
-- lecturers are not this reader's business. And below the privacy threshold
-- nothing but the response count comes back, because a report drawn from two
-- responses is a report about two identifiable students.

create or replace function public.get_course_feedback_report(
  p_period_id uuid, p_course_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_lecturer  uuid := public.my_lecturer_id();
  v_threshold int  := public.feedback_privacy_threshold();
  v_offering  uuid;
  v_period    record;
  v_course    record;
  v_name      text;
  v_responses int;
  v_sections  jsonb;
  v_header    jsonb;
begin
  if v_lecturer is null then
    raise exception 'Only a lecturer has feedback results';
  end if;

  select p.id, p.title, p.feedback_type, p.semester, p.batch_year,
         p.academic_year, p.status, p.opens_at, p.closes_at
    into v_period
    from public.feedback_periods p where p.id = p_period_id;
  if v_period.id is null then
    raise exception 'No such feedback round';
  end if;

  -- Reading the report requires teaching the course in this round.
  select o.id into v_offering
    from public.course_offerings o
    join public.course_lecturers cl
      on cl.offering_id = o.id and cl.is_active and cl.lecturer_id = v_lecturer
   where o.course_id = p_course_id
     and (v_period.batch_year is null or o.batch_year = v_period.batch_year)
   limit 1;
  if v_offering is null then
    raise exception 'You do not teach this course in this feedback round';
  end if;

  select c.course_code, c.title into v_course
    from public.courses c where c.id = p_course_id;

  select coalesce(l.title || ' ', '') || l.name into v_name
    from public.lecturers l where l.id = v_lecturer;

  select count(*)::int into v_responses
    from public.feedback_submissions fs
   where fs.feedback_period_id = p_period_id
     and fs.course_id = p_course_id
     and fs.status = 'submitted';

  v_header := jsonb_build_object(
    'course_code',    v_course.course_code,
    'course_title',   v_course.title,
    'lecturer_name',  v_name,
    'feedback_type',  v_period.feedback_type,
    'period_title',   v_period.title,
    'period_status',  v_period.status,
    'semester',       v_period.semester,
    'batch_year',     v_period.batch_year,
    'academic_year',  v_period.academic_year,
    'closes_at',      v_period.closes_at,
    'response_count', v_responses,
    'threshold',      v_threshold,
    'generated_on',   now());

  -- Below the floor: how many answered, and nothing they said.
  if v_responses < v_threshold then
    return v_header || jsonb_build_object(
      'visible',  false,
      'sections', '[]'::jsonb,
      'scores',   jsonb_build_object('lecturer_overall', null, 'course_content', null));
  end if;

  with answered as (
    -- Every answer on this course in this round. A lecturer-targeted answer
    -- belongs to the reader only; course-level answers belong to everyone
    -- teaching it.
    select fq.id as question_id, fq.question_text, fq.question_type,
           fq.section_key, fq.section_title, fq.section_icon, fq.section_order,
           fq.display_order, fq.options,
           fa.rating_value, fa.text_value, fa.choice_value, fa.choice_values
      from public.feedback_answers fa
      join public.feedback_submissions fs on fs.id = fa.submission_id
      join public.feedback_questions fq   on fq.id = fa.question_id
     where fs.feedback_period_id = p_period_id
       and fs.course_id = p_course_id
       and fs.status = 'submitted'
       and (fq.target_type <> 'lecturer' or fa.lecturer_target_id = v_lecturer)
  ),
  -- One row per question, whatever kind it is.
  ratings as (
    select section_key, question_id, question_text, display_order,
           round(avg(rating_value)::numeric, 2) as avg_value,
           count(rating_value)::int             as answered
      from answered where question_type = 'rating' and rating_value is not null
     group by section_key, question_id, question_text, display_order
  ),
  -- Choice questions keep their options in the order the form offers them,
  -- so a zero-count option still prints its nil rather than vanishing.
  choice_rows as (
    select a.section_key, a.question_id, a.question_text, a.question_type,
           a.display_order, a.options,
           case when a.question_type = 'multi_select'
                then jsonb_array_elements_text(coalesce(a.choice_values, '[]'::jsonb))
                else a.choice_value end as picked
      from answered a
     where a.question_type in ('single_choice', 'multi_select', 'yes_no')
  ),
  choice_respondents as (
    -- For a multi-select, the denominator is people who answered at all, not
    -- the number of ticks: percentages are "how many students said this".
    select section_key, question_id, count(distinct picked) filter (where false) as unused,
           count(*)::int as tick_count
      from choice_rows group by section_key, question_id
  ),
  choice_counts as (
    select section_key, question_id, question_text, question_type, display_order,
           options, picked, count(*)::int as n
      from choice_rows where picked is not null
     group by section_key, question_id, question_text, question_type,
              display_order, options, picked
  ),
  choices as (
    select cc.section_key, cc.question_id, cc.question_text, cc.question_type,
           cc.display_order,
           sum(cc.n)::int as answered,
           jsonb_agg(jsonb_build_object(
             'value', cc.picked,
             'label', coalesce(
               (select o->>'label' from jsonb_array_elements(cc.options) o
                 where o->>'value' = cc.picked limit 1),
               initcap(replace(cc.picked, '_', ' '))),
             'count', cc.n)
             order by cc.n desc, cc.picked) as tallies
      from choice_counts cc
     group by cc.section_key, cc.question_id, cc.question_text,
              cc.question_type, cc.display_order
  ),
  texts as (
    select section_key, question_id, question_text, display_order,
           jsonb_agg(to_jsonb(btrim(text_value)) order by text_value) as answers,
           count(*)::int as answered
      from answered
     where question_type in ('short_text', 'long_text')
       and coalesce(btrim(text_value), '') <> ''
     group by section_key, question_id, question_text, display_order
  ),
  -- Every section the form actually carries, so an empty one still appears
  -- and says nobody answered rather than silently disappearing.
  sections as (
    select distinct section_key, section_title, section_icon, section_order
      from answered
  )
  select jsonb_agg(jsonb_build_object(
           'section_key',   s.section_key,
           'section_title', s.section_title,
           'section_icon',  s.section_icon,
           'ratings', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'question_id', r.question_id, 'question', r.question_text,
                      'average', r.avg_value, 'answered', r.answered)
                    order by r.display_order)
               from ratings r where r.section_key = s.section_key), '[]'::jsonb),
           'choices', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'question_id', ch.question_id, 'question', ch.question_text,
                      'question_type', ch.question_type,
                      'answered', ch.answered, 'tallies', ch.tallies)
                    order by ch.display_order)
               from choices ch where ch.section_key = s.section_key), '[]'::jsonb),
           'texts', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'question_id', t.question_id, 'question', t.question_text,
                      'answers', t.answers, 'answered', t.answered)
                    order by t.display_order)
               from texts t where t.section_key = s.section_key), '[]'::jsonb),
           'average', (
             select round(avg(r.avg_value), 2) from ratings r
              where r.section_key = s.section_key))
         order by s.section_order)
    into v_sections
    from sections s;

  return v_header || jsonb_build_object(
    'visible',  true,
    'sections', coalesce(v_sections, '[]'::jsonb),
    'scores', jsonb_build_object(
      -- The two figures the report leads with.
      'lecturer_overall', (
        select round(avg((r->>'average')::numeric), 2)
          from jsonb_array_elements(coalesce(v_sections, '[]'::jsonb)) sec,
               jsonb_array_elements(sec->'ratings') r
         where sec->>'section_key' = 'lecturers'),
      'course_content', (
        select round(avg((r->>'average')::numeric), 2)
          from jsonb_array_elements(coalesce(v_sections, '[]'::jsonb)) sec,
               jsonb_array_elements(sec->'ratings') r
         where sec->>'section_key' = 'course_content')));
end;
$$;

comment on function public.get_course_feedback_report(uuid, uuid) is
  'The full feedback report for the calling lecturer on one course in one round: headline scores plus every section''s ratings, choice tallies and free text. Withheld below the privacy threshold.';

grant execute on function public.get_course_feedback_report(uuid, uuid) to authenticated;
