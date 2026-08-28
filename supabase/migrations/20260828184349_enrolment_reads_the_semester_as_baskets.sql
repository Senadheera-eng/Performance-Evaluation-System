-- enrolment_reads_the_semester_as_baskets
-- Applied 20260828184349
-- Exported from the live project; do not edit by hand.

-- Enrolment, shaped like the handbook's table.
--
-- A semester is not a list of courses a student takes; it is a set of baskets
-- they satisfy. Semester 7 of Computer Engineering is four compulsory courses,
-- then two credits from Elective (2), three from Elective (3), one from
-- Elective (1). The page could only ever show a flat list, so the rules lived
-- in a PDF and the student had to hold them in their head while ticking boxes.
--
-- Nothing here forbids anything. The handbook's requirement is the number a
-- basket asks for, not a ceiling: a student who wants a third elective may
-- take it, and one who leaves a compulsory course unticked is told so rather
-- than stopped. What the system owes them is a clear account of where they
-- stand, which is what this returns.

create or replace function public.get_my_enrolment_plan()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_student  record;
  v_sem      integer;
  v_dept_key text;
  v_year     text;
  v_baskets  jsonb;
  v_minors   jsonb;
  v_window   jsonb;
begin
  select s.id, s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student.id is null then
    raise exception 'Only a student has an enrolment plan';
  end if;

  v_sem := public.current_semester_for_batch(v_student.batch_year);
  -- The first year is common to the faculty; after that a semester belongs to
  -- the student's own department.
  v_dept_key := case when v_sem <= 2 then 'COMMON' else v_student.department end;
  v_year := (v_student.batch_year + ceil(v_sem / 2.0)::int - 1)::text || '/'
          || (v_student.batch_year + ceil(v_sem / 2.0)::int)::text;

  -- The window, if one is open for this student's semester.
  select to_jsonb(w) into v_window
    from (select p.id as period_id, p.title, p.closes_at
            from public.enrollment_periods p
           where p.status = 'open'
             and now() between p.opens_at and p.closes_at
             and (p.department is null or p.department = v_student.department)
             and p.semester = v_sem
           limit 1) w;

  with slot as (
    select s.basket, s.required_credits, c.id as course_id, c.course_code,
           c.title, c.credits, c.contributes_to_gpa, c.minor_category,
           exists (select 1 from public.enrollments e
                    where e.student_id = v_student.id
                      and e.course_id = c.id
                      and e.status = 'enrolled') as selected,
           exists (select 1 from public.results r
                    where r.student_id = v_student.id
                      and r.course_id = c.id
                      and r.is_published
                      and r.grade not in ('R', 'L', 'F')) as already_passed
      from public.curriculum_slots s
      join public.courses c on c.id = s.course_id
     where s.department = v_dept_key and s.semester = v_sem
  )
  select jsonb_agg(b order by b->>'sort_key')
    into v_baskets
    from (
      select jsonb_build_object(
               -- Compulsory first, then the electives in label order, then
               -- anything optional: the order the handbook prints them in.
               'sort_key', case when basket = 'Compulsory' then '0'
                                when basket = 'Optional' then '2' else '1' end || basket,
               'basket', basket,
               'required_credits', max(required_credits),
               'selected_credits',
                 coalesce(sum(credits) filter (where selected), 0),
               'available_credits', sum(credits),
               'courses', jsonb_agg(jsonb_build_object(
                   'course_id', course_id, 'course_code', course_code,
                   'title', title, 'credits', credits,
                   'contributes_to_gpa', contributes_to_gpa,
                   'minor', minor_category,
                   'selected', selected,
                   'already_passed', already_passed)
                 order by course_code)) as b
        from slot
       group by basket
    ) t;

  -- Where each minor stands. Credits already earned count as well as credits
  -- selected now, because a minor is finished across the degree rather than
  -- inside one semester.
  select jsonb_agg(jsonb_build_object(
           'minor', m.minor,
           'required_credits', m.required_credits,
           'earned_credits', coalesce(e.earned, 0),
           'selected_credits', coalesce(e.selected, 0),
           'status', case
             when coalesce(e.earned, 0) + coalesce(e.selected, 0) >= m.required_credits
               then 'complete'
             when coalesce(e.earned, 0) + coalesce(e.selected, 0) > 0 then 'partial'
             else 'none' end)
         order by m.minor)
    into v_minors
    from public.minor_requirements m
    left join lateral (
      select sum(c.credits) filter (
               where exists (select 1 from public.results r
                              where r.student_id = v_student.id and r.course_id = c.id
                                and r.is_published and r.grade not in ('R','L','F'))) as earned,
             sum(c.credits) filter (
               where exists (select 1 from public.enrollments en
                              where en.student_id = v_student.id and en.course_id = c.id
                                and en.status = 'enrolled')
                 and not exists (select 1 from public.results r
                                  where r.student_id = v_student.id and r.course_id = c.id
                                    and r.is_published and r.grade not in ('R','L','F'))) as selected
        from public.courses c
       where c.minor_category = m.minor and c.department = m.department
    ) e on true
   where m.department = v_student.department;

  return jsonb_build_object(
    'semester',      v_sem,
    'academic_year', v_year,
    'department',    v_student.department,
    'curriculum_of', v_dept_key,
    'window',        v_window,
    'baskets',       coalesce(v_baskets, '[]'::jsonb),
    'minors',        coalesce(v_minors, '[]'::jsonb));
end;
$$;

grant execute on function public.get_my_enrolment_plan() to authenticated;
