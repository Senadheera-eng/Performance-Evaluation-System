-- Two department-wide reads were scoped with my_staff_department(), which
-- falls back to a lecturer's own department — so every lecturer could read
-- the whole department's course catalogue, who is assigned to each offering
-- and how many students are enrolled, along with the staff directory.
--
-- Both sit behind screens the sidebar shows only to a head of department,
-- and the code says in several places that those gates are presentation only
-- because the database enforces them independently. For these two it did
-- not. They now use the same scope get_department_students already chose
-- deliberately for this reason: the head's appointment, or an admin.
create or replace function public.get_department_teaching(
  p_batch_year integer default null,
  p_semester integer default null)
returns table (
  offering_id uuid, course_id uuid, course_code text, course_title text,
  credits integer, category text, semester integer, academic_year text,
  batch_year integer, department text, lecturers jsonb, enrolled_count integer,
  batch_current_semester integer, is_current boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_department text;
  v_is_super   boolean;
begin
  v_is_super := coalesce(public.get_my_role(), '') = 'super_admin';

  -- Deliberately NOT my_staff_department(): that falls back to a lecturer's
  -- own department, and the department's whole teaching load is the head of
  -- department's scope, not every lecturer's. A lecturer's own offerings
  -- come from get_my_teaching().
  v_department := coalesce(public.my_hod_department(), public.get_my_department());

  if not v_is_super and v_department is null then
    raise exception
      'Department-wide teaching requires a department admin or an active HOD appointment';
  end if;

  return query
  with scoped as (
    select o.id, o.course_id, o.academic_year, o.batch_year, o.department, o.semester
      from public.course_offerings o
     where (v_is_super or o.department = v_department)
       and (p_batch_year is null or o.batch_year = p_batch_year)
       and (p_semester   is null or o.semester   = p_semester)
  ),
  batch_now as (
    select b.batch_year, public.current_semester_for_batch(b.batch_year) as sem
      from (select distinct s.batch_year from scoped s offset 0) b
  )
  select s.id, c.id, c.course_code, c.title, c.credits, c.category, c.semester,
         s.academic_year, s.batch_year, s.department,
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
            where cl.offering_id = s.id and cl.is_active
         ), '[]'::jsonb),
         public.offering_student_count(s.id),
         bn.sem,
         coalesce(c.semester = bn.sem, false)
    from scoped s
    join public.courses c on c.id = s.course_id
    left join batch_now bn on bn.batch_year = s.batch_year
   order by coalesce(c.semester = bn.sem, false) desc,
            s.batch_year desc, c.semester desc, c.course_code;
end;
$$;


create or replace function public.get_assignable_lecturers()
returns table (
  lecturer_id uuid, name text, email text, department text, is_hod boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_department text;
  v_is_super   boolean;
begin
  v_is_super := coalesce(public.get_my_role(), '') = 'super_admin';

  -- Who may be given a course is the head's business, for the same reason.
  v_department := coalesce(public.my_hod_department(), public.get_my_department());

  if not v_is_super and v_department is null then
    raise exception
      'The department staff list requires a department admin or an active HOD appointment';
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


-- Mentor allocation is already the head's alone, but its grant still let the
-- signed-out role call it and be refused inside. Nothing else in this module
-- is reachable that way.
revoke all on function public.get_department_mentor_roster() from public, anon;
grant execute on function public.get_department_mentor_roster() to authenticated;;
