-- hod_department_student_records
-- Applied 20260808123938
-- Exported from the live project; do not edit by hand.

-- A head of department oversees their department's students, not only the
-- ones on their own courses. `students` grants a lecturer nothing at all, so
-- this is resolved server-side and gated on the appointment.
--
-- Which students belong to a department: normally students.department. For
-- Interdisciplinary Studies — which owns courses but has no students of its
-- own — it is anyone who has taken an IS course, the same rule
-- students_is_admin_read already uses for the IS department admin.

create or replace function public.department_owns_student(
  p_department text,
  p_student_id uuid
)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if p_department = 'Interdisciplinary Studies' then
    return public.student_has_is_course_link(p_student_id);
  end if;
  return exists (
    select 1 from public.students s
     where s.id = p_student_id and s.department = p_department
  );
end;
$$;

/** True when the caller may see a given student's full academic record:
 *  super admin, that department's admin, or its sitting head. Lecturers get
 *  nothing here — their scope is the roster of a course they teach, which is
 *  get_offering_roster. */
create or replace function public.can_view_student_record(p_student_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_hod_department text;
begin
  if public.get_my_role() = 'super_admin' then
    return true;
  end if;
  if public.get_my_role() = 'dept_admin' then
    return public.department_owns_student(public.get_my_department(), p_student_id);
  end if;
  v_hod_department := public.my_hod_department();
  if v_hod_department is not null then
    return public.department_owns_student(v_hod_department, p_student_id);
  end if;
  return false;
end;
$$;

/** Every student in the caller's department, with the standing figures the
 *  overview list needs. CGPA is credit-weighted over published,
 *  GPA-contributing courses — the same definition the student's own Results
 *  page and get_academic_standing use, so the two can never disagree. */
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
  v_is_super   := public.get_my_role() = 'super_admin';
  v_department := coalesce(public.my_hod_department(), public.get_my_department());

  if not v_is_super and v_department is null then
    raise exception 'No department scope for this account';
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

/** One student's published results, semester by semester, with the SGPA for
 *  each. Staff see the component marks including ESE — the rule hides ESE
 *  from the student, not from the department. */
create or replace function public.get_student_academic_record(p_student_id uuid)
returns table (
  semester           integer,
  academic_year      text,
  course_code        text,
  course_title       text,
  credits            integer,
  contributes_to_gpa boolean,
  mid_sem_mark       double precision,
  ca_mark            double precision,
  ese_mark           double precision,
  oa_mark            double precision,
  grade              text,
  gpv                double precision
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if not public.can_view_student_record(p_student_id) then
    raise exception 'Not authorised to view this student''s record';
  end if;

  return query
  select c.semester, r.academic_year, c.course_code, c.title, c.credits,
         c.contributes_to_gpa,
         r.mid_sem_mark, r.ca_mark, r.ese_mark, r.oa_mark, r.grade, r.gpv
    from public.results r
    join public.courses c on c.id = r.course_id
   where r.student_id = p_student_id
     and r.is_published
   order by c.semester, c.course_code;
end;
$$;

revoke execute on function public.department_owns_student(text, uuid)      from public, anon;
revoke execute on function public.can_view_student_record(uuid)            from public, anon;
revoke execute on function public.get_department_students()                from public, anon;
revoke execute on function public.get_student_academic_record(uuid)        from public, anon;
grant  execute on function public.department_owns_student(text, uuid)      to authenticated;
grant  execute on function public.can_view_student_record(uuid)            to authenticated;
grant  execute on function public.get_department_students()                to authenticated;
grant  execute on function public.get_student_academic_record(uuid)        to authenticated;
