-- a_student_can_change_their_mind_while_the_window_is_open
-- Applied 20260828192311
-- Exported from the live project; do not edit by hand.

-- A student may change their mind while the window is open.
--
-- Enrolment was a one-way door: tick, confirm, and the checkbox was disabled
-- from then on. That is not how choosing courses works. A student picks an
-- elective, reads the description properly, talks to someone who took it last
-- year, and wants the other one. Until the department closes the window there
-- is no reason the system should be the thing standing in the way -- and after
-- it closes, there is every reason.
--
-- So both directions run through one function, and both ask the same question:
-- is a window that carries this course open right now? Adding and dropping are
-- the same permission, which is what makes the deadline mean something. The
-- one thing a deadline cannot undo is marks: once a lecturer has recorded a
-- result the enrolment is part of the record, and dropping it would leave the
-- mark attached to a course the student was never signed up for.

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

    -- A recorded mark outlives the window. Removing the enrolment under it
    -- would orphan the result, so this is the department's to undo, not the
    -- student's.
    if exists (select 1 from public.results r
                where r.student_id = v_student.id and r.course_id = v_course) then
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

comment on function public.update_my_enrolment(uuid[], uuid[]) is
  'Adds and drops courses for the signed-in student, both only while a window carrying the course is open and no marks have been recorded.';

grant execute on function public.update_my_enrolment(uuid[], uuid[]) to authenticated;

-- The plan now has to say whether the window is open, not merely hand back one
-- when it is. A student who missed the deadline was shown the same page as one
-- for whom enrolment had never opened at all, with no way to tell the two
-- apart or to see when the door shut.
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
           -- Any mark at all, published or not: once one exists the choice is
           -- no longer the student's to take back.
           exists (select 1 from public.results r
                    where r.student_id = v_student.id
                      and r.course_id = c.id) as locked
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
                   'already_passed', already_passed,
                   'locked', locked)
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

-- The outstanding-module list has to answer the same question, so a repeat can
-- be dropped inside the window like anything else.
drop function if exists public.get_my_enrolment_options();

create function public.get_my_enrolment_options()
returns table(
  course_id uuid, course_code text, title text, credits integer, semester integer,
  category text, department text, kind text, outstanding_from text,
  period_id uuid, period_title text, period_batch integer, period_semester integer,
  period_academic_year text, closes_at timestamp with time zone, capacity integer,
  enrolled_count integer, already_enrolled boolean, locked boolean)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_student record;
  v_current integer;
begin
  select s.id, s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student is null then return; end if;

  v_current := public.current_semester_for_batch(v_student.batch_year);

  return query
  with windows as (
    select p.* from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
  ),
  offered as (
    select w.id as period_id, w.title as period_title, w.batch_year as period_batch,
           w.semester as period_semester, w.academic_year as period_academic_year,
           w.closes_at, c.id as course_id, pc.capacity
      from windows w
      join public.courses c on public.period_covers_course(w.id, c.id)
      left join public.enrollment_period_courses pc
        on pc.period_id = w.id and pc.course_id = c.id
  ),
  eligible as (
    select o.*,
           case
             when o.period_semester = v_current then 'regular'
             when r.grade = 'R' then 'repeat_r'
             when r.grade = 'L' then 'repeat_l'
           end as kind,
           r.grade as outstanding_from
      from offered o
      left join public.results r
        on r.student_id = v_student.id and r.course_id = o.course_id
       and r.is_published and r.grade in ('R', 'L')
  )
  select c.id, c.course_code, c.title, c.credits, c.semester, c.category, c.department,
         e.kind, e.outstanding_from,
         e.period_id, e.period_title, e.period_batch, e.period_semester,
         e.period_academic_year, e.closes_at, e.capacity,
         (select count(*)::int from public.enrollments en
           where en.course_id = c.id
             and en.academic_year = e.period_academic_year
             and en.status = 'enrolled'),
         exists (select 1 from public.enrollments en
                  where en.student_id = v_student.id and en.course_id = c.id
                    and en.academic_year = e.period_academic_year),
         -- A repeat sat under an earlier grade always has a result row, so the
         -- lock has to mean a mark for the attempt being enrolled in now.
         exists (select 1 from public.results r2
                  where r2.student_id = v_student.id and r2.course_id = c.id
                    and r2.academic_year = e.period_academic_year)
    from eligible e
    join public.courses c on c.id = e.course_id
   where e.kind is not null
     -- A module owed is owed wherever it is taught, so a repeat is never
     -- filtered by department. The semester's own intake is: a student reads
     -- their own department's courses plus the shared ones.
     and (e.kind <> 'regular'
          or c.department = v_student.department
          or c.department = 'Interdisciplinary Studies')
   order by e.kind, c.semester, c.course_code;
end;
$$;

grant execute on function public.get_my_enrolment_options() to authenticated;
