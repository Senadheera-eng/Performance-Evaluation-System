-- A result belongs to the delivery it was earned in, whoever enters it.
--
-- The same split that had attendance showing two different registers was
-- waiting in results. A lecturer's sheet sends the offering with every row;
-- the department office's sheet sent only student, course and academic year.
-- Every row in the table happens to carry an offering today because they were
-- backfilled, but the next mark an admin typed would have had none — and the
-- lecturer's sheet, their draft/submitted/published counts and every screen
-- that reads results by offering would all have been blind to it.
--
-- So the database fills it in, the way it does for attendance: the writer's
-- offering if they gave one, otherwise the student's offering for that
-- course. It also records who entered a mark, which only the lecturer's
-- sheet was doing.
create or replace function public.results_fill_offering()
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
    new.entered_by := coalesce(new.entered_by, auth.uid());
  end if;
  return new;
end;
$$;

-- Runs before the grade-point and publication triggers; they do not read the
-- offering, but a row should be whole before anything else looks at it.
drop trigger if exists results_00_fill_offering on public.results;
create trigger results_00_fill_offering
  before insert or update on public.results
  for each row execute function public.results_fill_offering();

-- Nothing about attendance: the department's offerings, which the results
-- sheet now needs for the same reason the register did.
drop function if exists public.get_attendance_offerings();
create function public.get_admin_offerings()
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
#variable_conflict use_column
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
  -- Once per batch rather than once per offering.
  current_sem as (
    select b.batch_year, public.current_semester_for_batch(b.batch_year) as sem
      from (select distinct s.batch_year from scoped s offset 0) b
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
revoke all on function public.get_admin_offerings() from public, anon;
grant execute on function public.get_admin_offerings() to authenticated;