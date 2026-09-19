-- count_the_students_not_the_answers_they_left
-- Applied 20260830124147
-- Exported from the live project; do not edit by hand.

-- Count the students, not the answers they left.
--
-- The admin's course breakdown joined feedback_answers so it could average
-- the ratings, which multiplies each submission row by however many questions
-- that student answered. Then it counted those rows. One student who answered
-- twenty-nine questions was reported as twenty-nine responses, and as
-- twenty-nine anonymous ones -- while the header card on the same screen,
-- which counts submissions directly, said one. Two numbers about the same
-- thing, on the same page, disagreeing by a factor of the form's length.
--
-- The average genuinely wants the fanned-out rows; the counts want distinct
-- submissions. Saying so is the whole fix.
--
-- The second disagreement was the denominator. Eligibility counted everyone
-- ever enrolled in the course, across every batch, so a first-year course
-- taught for four years showed 162 eligible students for a round aimed at one
-- cohort of forty. A round is run for a batch, and the period says which; it
-- is only the caller's own filter that was optional, not the scoping.

create or replace function public.get_admin_course_feedback_analytics(p_period_id uuid)
returns table(
  course_id uuid, course_code text, title text, department text, semester integer,
  eligible_count integer, response_count integer, response_rate numeric,
  avg_rating numeric, anonymous_count integer, non_anonymous_count integer)
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_role  text := get_my_role();
  v_dept  text := get_my_department();
  v_batch int;
begin
  if v_role not in ('dept_admin', 'super_admin') then
    raise exception 'Access denied: admin role required';
  end if;

  -- The round names the cohort it was run for.
  select fp.batch_year into v_batch
    from feedback_periods fp where fp.id = p_period_id;

  return query
  with eligible as (
    select e.course_id, count(distinct e.student_id)::int as n
      from enrollments e
      join students s on s.id = e.student_id
     where e.status in ('enrolled', 'completed')
       and (v_batch is null or s.batch_year = v_batch)
     group by e.course_id
  )
  select c.id, c.course_code, c.title, c.department, c.semester,
         coalesce(el.n, 0),
         -- Distinct: the answer join below fans each submission out.
         count(distinct fs.id) filter (where fs.status = 'submitted')::int,
         case when coalesce(el.n, 0) > 0
              then round(
                     count(distinct fs.id) filter (where fs.status = 'submitted')::numeric
                     / el.n * 100, 1)
              else 0 end,
         -- The average is over answers, which is exactly what the fan-out
         -- gives it.
         round(avg(fa.rating_value) filter (where fs.status = 'submitted'), 2),
         count(distinct fs.id) filter (where fs.status = 'submitted' and fs.is_anonymous)::int,
         count(distinct fs.id) filter (where fs.status = 'submitted' and not fs.is_anonymous)::int
    from feedback_period_courses fpc
    join courses c on c.id = fpc.course_id
    left join eligible el on el.course_id = c.id
    left join feedback_submissions fs
      on fs.course_id = c.id and fs.feedback_period_id = fpc.feedback_period_id
    left join feedback_answers fa on fa.submission_id = fs.id
   where fpc.feedback_period_id = p_period_id
     and (v_role = 'super_admin' or c.department = v_dept)
   group by c.id, c.course_code, c.title, c.department, c.semester, el.n
   order by c.course_code;
end;
$$;

grant execute on function public.get_admin_course_feedback_analytics(uuid) to authenticated;

-- The header card reads the same cohort, so the two stop contradicting each
-- other. Patched in place rather than restated, so nothing else in a long
-- function can drift by accident.
do $$
declare
  v_def text;
  v_new text;
  v_step text;
begin
  v_def := pg_get_functiondef(
    'public.get_admin_feedback_summary(uuid,uuid,integer)'::regprocedure);
  v_new := v_def;

  v_step := '  v_total_eligible int;';
  if position(v_step in v_new) = 0 then
    raise exception 'get_admin_feedback_summary no longer declares v_total_eligible as expected';
  end if;
  v_new := replace(v_new, v_step,
    '  v_total_eligible int;' || chr(10) || '  v_batch int;');

  v_step := '  SELECT count(DISTINCT e.student_id) INTO v_total_eligible';
  if position(v_step in v_new) = 0 then
    raise exception 'get_admin_feedback_summary no longer counts eligibility as expected';
  end if;
  v_new := replace(v_new, v_step,
    '  v_batch := coalesce(p_batch_year,' || chr(10) ||
    '    (select fp.batch_year from feedback_periods fp where fp.id = p_period_id));' ||
    chr(10) || chr(10) || v_step);

  v_step := '    AND (p_batch_year IS NULL OR EXISTS (SELECT 1 FROM students s WHERE s.id = e.student_id AND s.batch_year = p_batch_year));';
  if position(v_step in v_new) = 0 then
    raise exception 'get_admin_feedback_summary no longer filters by batch as expected';
  end if;
  v_new := replace(v_new, v_step,
    '    AND (v_batch IS NULL OR EXISTS (SELECT 1 FROM students s' || chr(10) ||
    '                                     WHERE s.id = e.student_id' || chr(10) ||
    '                                       AND s.batch_year = v_batch));');

  execute v_new;
end
$$;
