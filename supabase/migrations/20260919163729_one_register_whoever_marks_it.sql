-- One register, whoever marks it.
--
-- A lecturer and a department admin mark the same `attendance` table, but
-- they did not see the same register:
--
--   * The lecturer's page reads by offering (the course as taught to one
--     batch in one year). The admin's page wrote rows without an offering,
--     so anything an admin added never appeared on the lecturer's sheet.
--   * The admin's class list was everyone who ever took the course, in any
--     year; the lecturer's was the offering's class. Same course, same date,
--     two different sets of names.
--
-- This makes the offering the thing both sides read and write, and gives
-- both the same class list.

-- 1. Every attendance row belongs to an offering, whoever wrote it. A
--    writer that already knows the offering (the lecturer's sheet, the
--    register close) is left alone; one that does not gets the student's
--    offering for that course, by the same rule the rest of the system uses.
create or replace function public.attendance_fill_offering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.offering_id is null then
    new.offering_id := public.offering_for_student_course(new.student_id, new.course_id);
  end if;
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(new.recorded_by, auth.uid());
  elsif new.status is distinct from old.status then
    -- A correction is a new recording: say who made it and when, so a mark
    -- changed by the office is not still credited to the lecturer's register.
    new.recorded_at := now();
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_fill_offering on public.attendance;
create trigger attendance_fill_offering
  before insert or update on public.attendance
  for each row execute function public.attendance_fill_offering();

-- Rows written before this existed.
update public.attendance a
   set offering_id = public.offering_for_student_course(a.student_id, a.course_id)
 where a.offering_id is null;

-- 2. Changes are pushed, not polled. Row security still decides who receives
--    a change: a department admin gets their own department's rows, a
--    lecturer their own offerings', a student only their own.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance'
  ) then
    alter publication supabase_realtime add table public.attendance;
  end if;
end $$;

-- 3. Who is in an offering's class, stated once. get_offering_roster (the
--    lecturer's sheet) and the admin views below all read this, so the
--    lists cannot drift apart again.
create or replace function public.offering_roster_ids(p_offering_id uuid)
returns table (student_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select s.id
    from public.students s
    join public.course_offerings o on o.id = p_offering_id
   where s.role = 'student'
     and (
       exists (select 1 from public.enrollments e
                where e.student_id = s.id
                  and e.course_id = o.course_id
                  and e.academic_year = o.academic_year)
       or exists (select 1 from public.results r
                   where r.student_id = s.id and r.offering_id = p_offering_id)
     );
$$;
revoke all on function public.offering_roster_ids(uuid) from public, anon, authenticated;

create or replace function public.get_offering_roster(p_offering_id uuid)
returns table (student_id uuid, name text, index_number text, reg_number text,
               department text, batch_year integer, is_repeat boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_batch integer;
begin
  if not public.is_offering_staff(p_offering_id) then
    raise exception 'Not authorised for this course offering';
  end if;

  select o.batch_year into v_batch
    from public.course_offerings o where o.id = p_offering_id;

  return query
  select s.id, s.name, s.index_number, s.reg_number, s.department, s.batch_year,
         (s.batch_year is distinct from v_batch) as is_repeat
    from public.offering_roster_ids(p_offering_id) r
    join public.students s on s.id = r.student_id
   order by s.index_number;
end;
$$;

-- 4. The admin's course list: every offering the department delivers, with
--    how big the class is and how many lectures have been recorded.
create or replace function public.get_attendance_offerings()
returns table (
  offering_id uuid, course_id uuid, course_code text, course_title text,
  semester integer, academic_year text, batch_year integer, department text,
  student_count integer, lectures_held integer, last_lecture date,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(public.get_my_role(), '');
  v_dept text := public.get_my_department();
begin
  if v_role not in ('dept_admin', 'super_admin') then
    raise exception 'Access denied: admin role required';
  end if;

  return query
  with scoped as (
    select o.id, o.course_id, c.course_code, c.title, c.semester,
           o.academic_year, o.batch_year, o.department
      from public.course_offerings o
      join public.courses c on c.id = o.course_id
     where v_role = 'super_admin' or o.department = v_dept
  ),
  -- Once per batch, not once per offering.
  current_sem as (
    select b.batch_year, public.current_semester_for_batch(b.batch_year) as sem
      from (select distinct batch_year from scoped offset 0) b
  )
  select sc.id, sc.course_id, sc.course_code, sc.title, sc.semester,
         sc.academic_year, sc.batch_year, sc.department,
         (select count(*)::int from public.offering_roster_ids(sc.id)),
         (select count(distinct a.lecture_date)::int
            from public.attendance a where a.offering_id = sc.id),
         (select max(a.lecture_date) from public.attendance a where a.offering_id = sc.id),
         coalesce(cs.sem = sc.semester, false)
    from scoped sc
    left join current_sem cs on cs.batch_year = sc.batch_year
   order by sc.batch_year desc, sc.semester, sc.course_code;
end;
$$;
revoke all on function public.get_attendance_offerings() from public, anon;
grant execute on function public.get_attendance_offerings() to authenticated;

-- 5. Each student's record for one offering: the same class list and the
--    same rows the lecturer's sheet totals, so the two percentages agree.
create or replace function public.get_offering_attendance_summary(p_offering_id uuid)
returns table (
  student_id uuid, name text, index_number text, reg_number text,
  batch_year integer, is_repeat boolean,
  present integer, absent integer, excused integer,
  lectures_held integer, last_marked date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_held integer;
begin
  if not public.is_offering_staff(p_offering_id) then
    raise exception 'Not authorised for this course offering';
  end if;

  select count(distinct a.lecture_date)::int into v_held
    from public.attendance a where a.offering_id = p_offering_id;

  return query
  select r.student_id, r.name, r.index_number, r.reg_number, r.batch_year, r.is_repeat,
         count(*) filter (where a.status = 'present')::int,
         count(*) filter (where a.status = 'absent')::int,
         count(*) filter (where a.status = 'excused')::int,
         v_held,
         max(a.lecture_date)
    from public.get_offering_roster(p_offering_id) r
    left join public.attendance a
      on a.offering_id = p_offering_id and a.student_id = r.student_id
   group by r.student_id, r.name, r.index_number, r.reg_number, r.batch_year, r.is_repeat
   order by r.index_number;
end;
$$;
revoke all on function public.get_offering_attendance_summary(uuid) from public, anon;
grant execute on function public.get_offering_attendance_summary(uuid) to authenticated;