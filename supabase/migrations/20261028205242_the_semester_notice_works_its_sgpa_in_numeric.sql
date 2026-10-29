-- A grade point is stored as double precision, and round(x, 2) takes a
-- numeric: the semester notice failed (quietly, as designed) at its SGPA.
create or replace function public.nudge_semester_complete(p_student uuid, p_semester integer, p_year text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrolled  int;
  v_missing   int;
  v_sgpa      numeric;
  v_plan      jsonb;
  v_credits   numeric;
  v_points    numeric;
  v_remaining numeric;
  v_final     numeric;
  v_sems      text;
  v_aim       text;
  v_class     record;
  v_required  numeric;
  v_title     text;
  v_body      text;
begin
  -- Complete: every GPA course of the semester taken that year has its
  -- result (a non-GPA course such as English may never have one in PES). An
  -- enrolment stays counted once it is marked completed. A year of repeats
  -- alone is not the semester itself, and a semester with no enrolment rows
  -- predates enrolment in PES: nothing to say.
  select count(*) filter (where e.first_attempt),
         count(*) filter (where not exists (
           select 1 from public.results r
            where r.student_id = p_student and r.course_id = e.course_id
              and r.academic_year = p_year and r.is_published))
    into v_enrolled, v_missing
    from (select e.course_id,
                 bool_or(e.enrollment_kind = 'regular' and not exists (
                   select 1 from public.results r
                    where r.student_id = p_student and r.course_id = e.course_id
                      and r.academic_year < p_year)) as first_attempt
            from public.enrollments e
            join public.courses c on c.id = e.course_id
           where e.student_id = p_student and e.status in ('enrolled', 'completed')
             and e.academic_year = p_year
             and c.semester = p_semester and c.graded_with is null
             and c.contributes_to_gpa
           group by e.course_id) e;
  if coalesce(v_enrolled, 0) = 0 or v_missing > 0 then
    return;
  end if;

  v_title := 'Semester ' || p_semester || ' results are complete';
  if exists (select 1 from public.notifications n
              where n.recipient_id = p_student and n.kind = 'semester_complete'
                and n.title like v_title || '%') then
    return;
  end if;

  select round(sum(c.result_credits * r.gpv::numeric) / nullif(sum(c.result_credits), 0), 2)
    into v_sgpa
    from public.results r
    join public.courses c on c.id = r.course_id
   where r.student_id = p_student and r.is_published and r.gpv is not null
     and c.contributes_to_gpa and c.semester = p_semester;
  if v_sgpa is not null then
    v_title := v_title || ': SGPA ' || to_char(v_sgpa, 'FM0.00');
  end if;

  v_plan      := public.graduation_plan_for(p_student);
  v_credits   := (v_plan #>> '{completed,credits}')::numeric;
  v_points    := (v_plan #>> '{completed,points}')::numeric;
  select coalesce(sum((x->>'credits')::numeric), 0),
         string_agg('Semester ' || (x->>'semester'), ' and ' order by (x->>'semester')::int)
    into v_remaining, v_sems
    from jsonb_array_elements(v_plan->'semesters') x
   where (x->>'credits')::numeric > 0;
  v_final := v_credits + v_remaining;

  select a.class_key into v_aim from public.planner_aims a where a.student_id = p_student;

  if v_remaining = 0 then
    select c->>'label' as label into v_class
      from public.system_settings s, jsonb_array_elements(s.value) c
     where s.key = 'honours_classifications'
       and v_credits > 0 and v_points / v_credits >= (c->>'threshold')::numeric
     order by (c->>'threshold')::numeric desc limit 1;
    v_body := 'Your CGPA is ' || to_char(round(v_points / nullif(v_credits, 0), 2), 'FM0.00')
           || coalesce(': ' || v_class.label, '') || '.';
  else
    -- The aim if there is one; else the best class still open.
    select c->>'label' as label, (c->>'threshold')::numeric as threshold,
           ((c->>'threshold')::numeric * v_final - v_points) / v_remaining as required
      into v_class
      from public.system_settings s, jsonb_array_elements(s.value) c
     where s.key = 'honours_classifications'
     order by (c->>'key') = coalesce(v_aim, '') desc,
              (((c->>'threshold')::numeric * v_final - v_points) / v_remaining between 0.0001 and 4) desc,
              (c->>'threshold')::numeric desc
     limit 1;
    v_required := v_class.required;
    v_body := case
      when v_required <= 0 then
        v_class.label || ' is secured: even a 0.00 average from here keeps you above '
          || to_char(v_class.threshold, 'FM0.00') || '.'
      when v_required > 4 then
        v_class.label || ' now needs more than a 4.00 average. The Graduation Planner shows what is still within reach.'
      else
        'To finish with ' || v_class.label || ', you now need an SGPA of '
          || to_char(v_required, 'FM0.00') || ' in ' || v_sems || '.'
    end;
  end if;

  perform public.notify_user(p_student, 'results', 'semester_complete', v_title, v_body,
                             '/app/planner', 'semester', null);
end;
$$;
revoke all on function public.nudge_semester_complete(uuid, integer, text) from public, anon, authenticated;

