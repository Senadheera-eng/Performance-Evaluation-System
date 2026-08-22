-- repeat_and_medical_students_may_enrol_with_a_later_batch
-- Applied 20260822125928
-- Exported from the live project; do not edit by hand.

-- A student carrying an R or an L has to take that module again with whichever
-- batch it is next offered to. Eligibility was decided purely by the student's
-- own batch year, so when the department opened Semester 4 for Batch 8 the
-- Batch 7 student who still owed CO3204 saw nothing at all.
--
-- Eligibility now has two routes. The ordinary one is unchanged: an open window
-- for your own batch. The second is narrow on purpose — an open window for any
-- batch, but only for the specific modules you still owe. A repeat student
-- gets the module they owe, not the newer batch's timetable.

alter table public.enrollments
  add column if not exists enrollment_kind text not null default 'regular',
  add column if not exists enrolled_with_batch integer;

alter table public.enrollments drop constraint if exists enrollments_kind_check;
alter table public.enrollments
  add constraint enrollments_kind_check
  check (enrollment_kind in ('regular', 'repeat_r', 'repeat_l'));

comment on column public.enrollments.enrollment_kind is
  'regular, repeat_r (retaking after an R) or repeat_l (retaking after an L). Kept after enrolment so it stays clear why a student is sitting with another batch.';
comment on column public.enrollments.enrolled_with_batch is
  'The batch year of the enrolment window used. Differs from the student''s own batch on a repeat.';

/** Modules the caller still owes — an R or an L that has not been re-sat.
 *  Once the re-sit is graded the row's grade is no longer R or L, so it drops
 *  out of here by itself. */
create or replace function public.my_outstanding_modules()
returns table (
  course_id     uuid,
  course_code   text,
  title         text,
  credits       integer,
  semester      integer,
  department    text,
  outstanding   text,
  from_year     text
)
language sql
stable security definer
set search_path to 'public'
as $$
  select c.id, c.course_code, c.title, c.credits, c.semester, c.department,
         r.grade, r.academic_year
    from public.results r
    join public.courses c on c.id = r.course_id
   where r.student_id = auth.uid()
     and r.is_published
     and r.grade in ('R', 'L')
   order by r.grade, c.course_code;
$$;

/** Whether one specific course is open to the caller right now, and on what
 *  footing. Returns null when it is not. */
create or replace function public.enrolment_kind_for_course(p_course_id uuid)
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_student   record;
  v_grade     text;
begin
  select s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student is null then return null; end if;

  -- Route 1 — an open window for the student's own batch.
  if exists (
    select 1 from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and p.batch_year = v_student.batch_year
       and (p.department is null or p.department = v_student.department)
       and (not exists (select 1 from public.enrollment_period_courses pc
                         where pc.period_id = p.id)
            or exists (select 1 from public.enrollment_period_courses pc
                        where pc.period_id = p.id and pc.course_id = p_course_id))
  ) then
    return 'regular';
  end if;

  -- Route 2 — a module still owed, offered to some batch in an open window.
  select r.grade into v_grade
    from public.results r
   where r.student_id = auth.uid()
     and r.course_id = p_course_id
     and r.is_published
     and r.grade in ('R', 'L');
  if v_grade is null then return null; end if;

  if exists (
    select 1 from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
       and (not exists (select 1 from public.enrollment_period_courses pc
                         where pc.period_id = p.id)
            or exists (select 1 from public.enrollment_period_courses pc
                        where pc.period_id = p.id and pc.course_id = p_course_id))
       -- the module must actually be delivered to that window's batch
       and exists (select 1 from public.course_offerings o
                    where o.course_id = p_course_id and o.batch_year = p.batch_year)
  ) then
    return case when v_grade = 'R' then 'repeat_r' else 'repeat_l' end;
  end if;

  return null;
end;
$$;

/** Everything the caller may enrol in right now, already grouped. */
create or replace function public.get_my_enrolment_options()
returns table (
  course_id      uuid,
  course_code    text,
  title          text,
  credits        integer,
  semester       integer,
  category       text,
  department     text,
  kind           text,
  outstanding_from text,
  period_id      uuid,
  period_title   text,
  period_batch   integer,
  closes_at      timestamptz,
  capacity       integer,
  enrolled_count integer,
  already_enrolled boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_student record;
begin
  select s.id, s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student is null then return; end if;

  return query
  with windows as (
    select p.* from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
  ),
  offered as (
    -- Courses each open window puts on the table.
    select w.id as period_id, w.title as period_title, w.batch_year as period_batch,
           w.closes_at, c.id as course_id, pc.capacity
      from windows w
      join public.courses c
        on (exists (select 1 from public.enrollment_period_courses x
                     where x.period_id = w.id and x.course_id = c.id)
            or (not exists (select 1 from public.enrollment_period_courses x
                             where x.period_id = w.id)
                and c.semester = w.semester))
      left join public.enrollment_period_courses pc
        on pc.period_id = w.id and pc.course_id = c.id
  ),
  eligible as (
    select o.*,
           case
             when w.batch_year = v_student.batch_year then 'regular'
             when r.grade = 'R' then 'repeat_r'
             when r.grade = 'L' then 'repeat_l'
           end as kind,
           r.grade as outstanding_from
      from offered o
      join windows w on w.id = o.period_id
      left join public.results r
        on r.student_id = v_student.id and r.course_id = o.course_id
       and r.is_published and r.grade in ('R', 'L')
     where w.batch_year = v_student.batch_year
        or r.grade is not null
  )
  select c.id, c.course_code, c.title, c.credits, c.semester, c.category, c.department,
         e.kind, e.outstanding_from,
         e.period_id, e.period_title, e.period_batch, e.closes_at, e.capacity,
         (select count(*)::int from public.enrollments en
           where en.course_id = c.id
             and en.academic_year = (select academic_year from public.enrollment_periods
                                      where id = e.period_id)),
         exists (select 1 from public.enrollments en
                  where en.student_id = v_student.id and en.course_id = c.id
                    and en.academic_year = (select academic_year from public.enrollment_periods
                                             where id = e.period_id))
    from eligible e
    join public.courses c on c.id = e.course_id
   where e.kind is not null
     -- A module already passed is never offered again as a repeat.
     and (e.kind = 'regular' or e.outstanding_from is not null)
   order by e.kind, c.semester, c.course_code;
end;
$$;

-- The insert policy checked only "is some window open for my batch", which
-- would now let a repeat student take anything the newer batch is offered.
-- It is replaced by a per-course check.
drop policy if exists enrollments_student_insert on public.enrollments;
create policy enrollments_student_insert on public.enrollments
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and public.enrolment_kind_for_course(course_id) is not null
    and enrollment_kind = public.enrolment_kind_for_course(course_id)
  );

revoke execute on function public.my_outstanding_modules()            from public, anon;
revoke execute on function public.enrolment_kind_for_course(uuid)     from public, anon;
revoke execute on function public.get_my_enrolment_options()          from public, anon;
grant  execute on function public.my_outstanding_modules()            to authenticated;
grant  execute on function public.enrolment_kind_for_course(uuid)     to authenticated;
grant  execute on function public.get_my_enrolment_options()          to authenticated;
