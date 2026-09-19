-- a_mark_locks_the_attempt_it_belongs_to_not_the_course
-- Applied 20260828193906
-- Exported from the live project; do not edit by hand.

-- A mark locks the attempt it belongs to, not the course.
--
-- The guard against dropping an enrolment that already carries marks was
-- written as "does this student have a result for this course", which is true
-- of every repeat by definition -- the R is the reason they are sitting it
-- again. That made repeat enrolments permanently undroppable while leaving the
-- actual case, a mark entered against the attempt in progress, no better
-- covered than before.
--
-- A result belongs to a year. So does an enrolment. The lock is the two
-- meeting: a mark recorded in the same academic year as the enrolment being
-- dropped.

create or replace function public.update_my_enrolment(
  p_add    uuid[] default '{}',
  p_remove uuid[] default '{}')
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_student record;
  v_course  uuid;
  v_kind    text;
  v_year    text;
  v_batch   integer;
  v_code    text;
  v_n       integer;
  v_added   integer := 0;
  v_removed integer := 0;
begin
  select s.id, s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student.id is null then
    raise exception 'Only a student can change their own enrolment';
  end if;

  -- Drops come first. A student swapping one elective for another would
  -- otherwise be turned away at a course with a capacity by the place they
  -- are in the middle of giving up.
  foreach v_course in array coalesce(p_remove, '{}'::uuid[]) loop
    select c.course_code into v_code from public.courses c where c.id = v_course;

    if public.enrolment_kind_for_course(v_course) is null then
      raise exception 'Enrolment has closed for %. Ask your department.', v_code;
    end if;

    -- A recorded mark outlives the window, and removing the enrolment under it
    -- would orphan the result. Scoped to the enrolment's own year: the old R
    -- that sent a student back to a course must not lock the repeat.
    if exists (
      select 1
        from public.enrollments e
        join public.results r
          on r.student_id = e.student_id
         and r.course_id  = e.course_id
         and r.academic_year = e.academic_year
       where e.student_id = v_student.id
         and e.course_id  = v_course
         and e.status     = 'enrolled') then
      raise exception 'Marks are already recorded for %. Ask your department to remove it.', v_code;
    end if;

    delete from public.enrollments e
     where e.student_id = v_student.id
       and e.course_id  = v_course
       and e.status     = 'enrolled';
    get diagnostics v_n = row_count;
    v_removed := v_removed + v_n;
  end loop;

  foreach v_course in array coalesce(p_add, '{}'::uuid[]) loop
    select c.course_code into v_code from public.courses c where c.id = v_course;

    v_kind := public.enrolment_kind_for_course(v_course);
    if v_kind is null then
      raise exception 'Enrolment is not open for %.', v_code;
    end if;

    -- The window carrying the course sets the year, not the student's own:
    -- a repeat is sat with whichever batch is taking it. Where two windows
    -- carry it, the one for this student's own semester wins.
    select p.academic_year, p.batch_year into v_year, v_batch
      from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
       and public.period_covers_course(p.id, v_course)
     order by (p.semester = public.current_semester_for_batch(v_student.batch_year)) desc,
              p.closes_at
     limit 1;

    insert into public.enrollments
      (student_id, course_id, academic_year, status, enrollment_kind, enrolled_with_batch)
    values (v_student.id, v_course, v_year, 'enrolled', v_kind,
            case when v_kind = 'regular' then null else v_batch end)
    on conflict (student_id, course_id, academic_year) do update
       set status = 'enrolled', enrollment_kind = excluded.enrollment_kind
     where public.enrollments.status is distinct from 'enrolled';
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  return jsonb_build_object('added', v_added, 'removed', v_removed);
end;
$$;

grant execute on function public.update_my_enrolment(uuid[], uuid[]) to authenticated;

-- The same correction where the plan reports it, so the page disables exactly
-- the checkboxes the function would refuse.
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
  v_dept_key := case when v_sem <= 2 then 'COMMON' else v_student.department end;
  v_year := (v_student.batch_year + ceil(v_sem / 2.0)::int - 1)::text || '/'
          || (v_student.batch_year + ceil(v_sem / 2.0)::int)::text;

  -- The open window for this semester if there is one; otherwise the last one
  -- there was, so the page can say when it closed rather than going quiet.
  select to_jsonb(w) into v_window
    from (select p.id as period_id, p.title, p.opens_at, p.closes_at,
                 (p.status = 'open' and now() between p.opens_at and p.closes_at)
                   as is_open
            from public.enrollment_periods p
           where (p.department is null or p.department = v_student.department)
             and p.semester = v_sem
           order by (p.status = 'open' and now() between p.opens_at and p.closes_at) desc,
                    p.closes_at desc
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
                      and r.grade not in ('R', 'L', 'F')) as already_passed,
           -- A mark against the attempt in progress, published or not: from
           -- there the choice is no longer the student's to take back.
           exists (select 1
                     from public.enrollments e
                     join public.results r
                       on r.student_id = e.student_id
                      and r.course_id  = e.course_id
                      and r.academic_year = e.academic_year
                    where e.student_id = v_student.id
                      and e.course_id  = c.id
                      and e.status     = 'enrolled') as locked
      from public.curriculum_slots s
      join public.courses c on c.id = s.course_id
     where s.department = v_dept_key and s.semester = v_sem
  )
  select jsonb_agg(b order by b->>'sort_key')
    into v_baskets
    from (
      select jsonb_build_object(
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
                   'already_passed', already_passed,
                   'locked', locked)
                 order by course_code)) as b
        from slot
       group by basket
    ) t;

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
