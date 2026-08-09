-- fix_null_role_three_valued_logic_in_staff_rpcs
-- Applied 20260808155127
-- Exported from the live project; do not edit by hand.

-- get_my_role() returns NULL for a lecturer — they are in neither `admins`
-- nor `students`. `NULL = 'super_admin'` is NULL, not false, so
-- `not v_is_super and v_department is null` evaluated to NULL and the guard's
-- IF never fired; the query then ran with `NULL or department_owns_student(...)`
-- and returned zero rows.
--
-- No data leaked — NULL is not true, so nothing matched — but the refusal
-- happened by accident of three-valued logic rather than by the check that
-- was written to produce it. Coalescing the role to '' makes every one of
-- these a real boolean, so the guards behave as they read.

create or replace function public.get_department_students()
returns table (
  student_id      uuid,
  name            text,
  index_number    text,
  reg_number      text,
  email           text,
  department      text,
  batch_year      integer,
  cgpa            numeric,
  gpa_credits     integer,
  courses_graded  integer,
  latest_semester integer
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_is_super   boolean;
begin
  v_is_super := coalesce(public.get_my_role(), '') = 'super_admin';

  -- Deliberately NOT my_staff_department(): that falls back to a lecturer's
  -- own department, and department-wide student records are the head of
  -- department's scope, not every lecturer's.
  v_department := coalesce(public.my_hod_department(), public.get_my_department());

  if not v_is_super and v_department is null then
    raise exception 'Department-wide student records require a department admin or an active HOD appointment';
  end if;

  return query
  with graded as (
    select r.student_id,
           sum(c.credits * r.gpv) filter (where c.contributes_to_gpa and r.gpv is not null) as weighted,
           sum(c.credits)         filter (where c.contributes_to_gpa and r.gpv is not null) as credits,
           count(*)                                                                        as graded_courses,
           max(c.semester)                                                                 as top_semester
      from public.results r
      join public.courses c on c.id = r.course_id
     where r.is_published
     group by r.student_id
  )
  select s.id, s.name, s.index_number, s.reg_number, s.email, s.department, s.batch_year,
         case when g.credits > 0 then round((g.weighted / g.credits)::numeric, 2) end,
         coalesce(g.credits, 0)::int,
         coalesce(g.graded_courses, 0)::int,
         coalesce(g.top_semester, 0)::int
    from public.students s
    left join graded g on g.student_id = s.id
   where s.role = 'student'
     and s.status = 'active'
     and (v_is_super or public.department_owns_student(v_department, s.id))
   order by s.batch_year desc, s.index_number;
end;
$$;

create or replace function public.can_view_student_record(p_student_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_role           text;
  v_hod_department text;
begin
  v_role := coalesce(public.get_my_role(), '');
  if v_role = 'super_admin' then
    return true;
  end if;
  if v_role = 'dept_admin' then
    return public.department_owns_student(public.get_my_department(), p_student_id);
  end if;
  v_hod_department := public.my_hod_department();
  if v_hod_department is not null then
    return public.department_owns_student(v_hod_department, p_student_id);
  end if;
  return false;
end;
$$;

create or replace function public.get_assignable_lecturers()
returns table (
  lecturer_id uuid,
  name        text,
  email       text,
  department  text,
  is_hod      boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_is_super   boolean;
begin
  v_is_super := coalesce(public.get_my_role(), '') = 'super_admin';
  v_department := public.my_staff_department();

  if not v_is_super and v_department is null then
    raise exception 'No department scope for this account';
  end if;

  return query
  select l.id,
         coalesce(l.title || ' ', '') || l.name,
         l.email,
         l.department,
         exists (select 1 from public.hod_appointments h
                  where h.lecturer_id = l.id and h.is_active)
    from public.lecturers l
   where l.status = 'active'
     and (v_is_super or l.department = v_department)
   order by l.department, l.name;
end;
$$;

create or replace function public.get_department_teaching(
  p_batch_year integer default null,
  p_semester   integer default null
)
returns table (
  offering_id     uuid,
  course_id       uuid,
  course_code     text,
  course_title    text,
  credits         integer,
  category        text,
  semester        integer,
  academic_year   text,
  batch_year      integer,
  department      text,
  lecturers       jsonb,
  enrolled_count  integer
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_is_super   boolean;
begin
  v_is_super := coalesce(public.get_my_role(), '') = 'super_admin';
  v_department := public.my_staff_department();

  if not v_is_super and v_department is null then
    raise exception 'No department scope for this account';
  end if;

  return query
  select o.id, c.id, c.course_code, c.title, c.credits, c.category, c.semester,
         o.academic_year, o.batch_year, o.department,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'assignment_id', cl.id,
                    'lecturer_id', l.id,
                    'name', coalesce(l.title || ' ', '') || l.name,
                    'email', l.email,
                    'assignment_role', cl.assignment_role)
                  order by cl.assignment_role desc, l.name)
             from public.course_lecturers cl
             join public.lecturers l on l.id = cl.lecturer_id
            where cl.offering_id = o.id and cl.is_active
         ), '[]'::jsonb),
         public.offering_student_count(o.id)
    from public.course_offerings o
    join public.courses c on c.id = o.course_id
   where (v_is_super or o.department = v_department)
     and (p_batch_year is null or o.batch_year = p_batch_year)
     and (p_semester   is null or o.semester   = p_semester)
   order by o.batch_year desc, c.semester desc, c.course_code;
end;
$$;

-- is_offering_staff had the same shape; make its super-admin check explicit
-- too so a NULL role can never short-circuit into an ambiguous result.
create or replace function public.is_offering_staff(p_offering_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_department text;
  v_role       text;
begin
  if p_offering_id is null then
    return false;
  end if;
  v_role := coalesce(public.get_my_role(), '');
  if v_role = 'super_admin' then
    return true;
  end if;
  v_department := public.offering_department(p_offering_id);
  if v_department is null then
    return false;
  end if;
  return public.is_assigned_lecturer(p_offering_id)
      or public.is_active_hod_of(v_department)
      or (v_role = 'dept_admin' and public.get_my_department() = v_department);
end;
$$;

revoke execute on function public.get_department_students()                 from public, anon;
revoke execute on function public.can_view_student_record(uuid)             from public, anon;
revoke execute on function public.get_assignable_lecturers()                from public, anon;
revoke execute on function public.get_department_teaching(integer, integer)  from public, anon;
revoke execute on function public.is_offering_staff(uuid)                   from public, anon;
grant  execute on function public.get_department_students()                 to authenticated;
grant  execute on function public.can_view_student_record(uuid)             to authenticated;
grant  execute on function public.get_assignable_lecturers()                to authenticated;
grant  execute on function public.get_department_teaching(integer, integer)  to authenticated;
grant  execute on function public.is_offering_staff(uuid)                   to authenticated;
