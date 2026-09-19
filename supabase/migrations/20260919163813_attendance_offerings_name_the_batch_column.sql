-- The output column batch_year shadowed the table column of the same name.
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
  -- Once per batch, not once per offering.
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
#variable_conflict use_column
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