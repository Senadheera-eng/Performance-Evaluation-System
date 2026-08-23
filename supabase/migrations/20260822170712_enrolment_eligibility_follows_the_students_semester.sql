-- enrolment_eligibility_follows_the_students_semester
-- Applied 20260822170712
-- Exported from the live project; do not edit by hand.

-- Enrolment eligibility is academic, not a batch label on the window.
--
-- A window carried a batch year and a student saw it when that batch matched
-- their own. So a Semester 2 window opened for Batch 7 -- a batch that is in
-- Semester 7 -- put the whole of Semester 7 within reach of every Batch 7
-- student, while the one student who actually owed a Semester 2 module saw
-- nothing: the window's batch was their own, so every course it carried was
-- labelled 'regular' and the repeat list came back empty.
--
-- A student now takes the window for the semester their batch is in, and
-- separately may take any module they still owe from a window that carries it,
-- whatever batch that window names.

-- Where a batch has got to. Results are published at the end of a semester, so
-- the highest published semester is the last one completed.
create or replace function public.current_semester_for_batch(p_batch_year integer)
returns integer
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(max(c.semester), 0) + 1
    from public.results r
    join public.courses  c on c.id = r.course_id
    join public.students s on s.id = r.student_id
   where s.batch_year = p_batch_year
     and r.is_published;
$$;

comment on function public.current_semester_for_batch(integer) is
  'The semester a batch is studying now: one past the highest it has published results for.';

-- The inverse, so naming the semester is enough when opening a window. Null
-- when no batch is there yet, which makes it a repeat-only window.
create or replace function public.batch_currently_in_semester(p_semester integer)
returns integer
language sql stable security definer set search_path to 'public'
as $$
  select b.batch_year
    from (select distinct s.batch_year
            from public.students s
           where s.role = 'student' and s.batch_year is not null) b
   where public.current_semester_for_batch(b.batch_year) = p_semester
   order by b.batch_year desc
   limit 1;
$$;

-- The signed-in student's own semester, for the enrolment page to say plainly
-- which semester it is talking about.
create or replace function public.my_current_semester()
returns integer
language sql stable security definer set search_path to 'public'
as $$
  select public.current_semester_for_batch(s.batch_year)
    from public.students s where s.id = auth.uid();
$$;

-- Does a window put this course on the table? An explicit course list wins;
-- without one the window covers its own semester.
create or replace function public.period_covers_course(p_period_id uuid, p_course_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select case
    when exists (select 1 from public.enrollment_period_courses pc
                  where pc.period_id = p_period_id)
      then exists (select 1 from public.enrollment_period_courses pc
                    where pc.period_id = p_period_id and pc.course_id = p_course_id)
    else exists (select 1 from public.enrollment_periods p
                  join public.courses c on c.id = p_course_id
                 where p.id = p_period_id and c.semester = p.semester)
  end;
$$;

-- A window whose semester no batch is currently in serves repeat students
-- only. Saying so beats naming a batch the window does not serve.
alter table public.enrollment_periods alter column batch_year drop not null;

grant execute on function public.current_semester_for_batch(integer) to authenticated;
grant execute on function public.batch_currently_in_semester(integer) to authenticated;
grant execute on function public.my_current_semester() to authenticated;
grant execute on function public.period_covers_course(uuid, uuid) to authenticated;

-- Is a window open for the semester this student is actually in?
create or replace function public.enrollment_window_open_for_me()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
      from public.enrollment_periods p
      join public.students s on s.id = auth.uid()
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = s.department)
       and p.semester = public.current_semester_for_batch(s.batch_year)
  );
$$;

create or replace function public.enrolment_kind_for_course(p_course_id uuid)
returns text
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_student record;
  v_grade   text;
begin
  select s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student is null then return null; end if;

  -- Route 1 -- the window for the semester this student's batch is in now.
  if exists (
    select 1 from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
       and p.semester = public.current_semester_for_batch(v_student.batch_year)
       and public.period_covers_course(p.id, p_course_id)
  ) then
    return 'regular';
  end if;

  -- Route 2 -- a module still owed, carried by any open window. The window
  -- naming the course is the offer; the student's own batch does not enter
  -- into it, which is the whole point of sitting with a later batch.
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
       and public.period_covers_course(p.id, p_course_id)
  ) then
    return case when v_grade = 'R' then 'repeat_r' else 'repeat_l' end;
  end if;

  return null;
end;
$$;

drop function if exists public.get_my_enrolment_options();

create function public.get_my_enrolment_options()
returns table(
  course_id uuid, course_code text, title text, credits integer, semester integer,
  category text, department text, kind text, outstanding_from text,
  period_id uuid, period_title text, period_batch integer, period_semester integer,
  period_academic_year text, closes_at timestamp with time zone, capacity integer,
  enrolled_count integer, already_enrolled boolean)
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
                    and en.academic_year = e.period_academic_year)
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

-- The admin's counts have to answer the same question the student's page does,
-- or a repeat-only window reports every student in the batch as eligible.
create or replace function public.get_enrollment_period_course_stats(p_period_id uuid)
returns table(course_id uuid, course_code text, course_title text, capacity integer,
              eligible_count integer, enrolled_count integer)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_role       text := get_my_role();
  v_admin_dept text := get_my_department();
  v_period_dept text;
  v_semester   integer;
  v_year       text;
  v_found      boolean;
begin
  if v_role not in ('dept_admin','super_admin') then
    raise exception 'Access denied: admin role required';
  end if;

  select true, p.department, p.semester, p.academic_year
    into v_found, v_period_dept, v_semester, v_year
    from enrollment_periods p where p.id = p_period_id;

  if not coalesce(v_found, false) then
    raise exception 'Enrollment period not found';
  end if;

  return query
  select
    c.id, c.course_code, c.title, epc.capacity,
    (select count(*)::int from students s
      where s.role = 'student'
        and (v_period_dept is null or s.department = v_period_dept)
        and (v_role = 'super_admin' or s.department = v_admin_dept)
        and (
          current_semester_for_batch(s.batch_year) = v_semester
          or exists (select 1 from results r
                      where r.student_id = s.id and r.course_id = c.id
                        and r.is_published and r.grade in ('R','L'))
        )
    ),
    (select count(distinct e.student_id)::int from enrollments e
      join students s on s.id = e.student_id
      where e.status = 'enrolled'
        and e.course_id = c.id
        and e.academic_year = v_year
        and (v_period_dept is null or s.department = v_period_dept)
        and (v_role = 'super_admin' or s.department = v_admin_dept)
    )
  from courses c
  left join enrollment_period_courses epc
    on epc.period_id = p_period_id and epc.course_id = c.id
  where (v_role = 'super_admin'
         or c.department = v_admin_dept
         or c.department = 'Interdisciplinary Studies')
    and period_covers_course(p_period_id, c.id)
  order by c.course_code;
end;
$$;

create or replace function public.get_enrollment_period_summary(p_period_id uuid)
returns table(eligible_count integer, enrolled_count integer)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_role       text := get_my_role();
  v_admin_dept text := get_my_department();
  v_period_dept text;
  v_semester   integer;
  v_year       text;
  v_found      boolean;
begin
  if v_role not in ('dept_admin','super_admin') then
    raise exception 'Access denied: admin role required';
  end if;

  select true, p.department, p.semester, p.academic_year
    into v_found, v_period_dept, v_semester, v_year
    from enrollment_periods p where p.id = p_period_id;

  if not coalesce(v_found, false) then
    raise exception 'Enrollment period not found';
  end if;

  return query
  select
    (select count(*)::int from students s
      where s.role = 'student'
        and (v_period_dept is null or s.department = v_period_dept)
        and (v_role = 'super_admin' or s.department = v_admin_dept)
        and (
          current_semester_for_batch(s.batch_year) = v_semester
          or exists (select 1 from results r
                      where r.student_id = s.id and r.is_published
                        and r.grade in ('R','L')
                        and period_covers_course(p_period_id, r.course_id))
        )
    ),
    (select count(distinct e.student_id)::int from enrollments e
      join students s on s.id = e.student_id
      join courses  c on c.id = e.course_id
      where e.status = 'enrolled'
        and e.academic_year = v_year
        and (v_period_dept is null or s.department = v_period_dept)
        and (v_role = 'super_admin' or s.department = v_admin_dept)
        and (v_role = 'super_admin'
             or c.department = v_admin_dept
             or c.department = 'Interdisciplinary Studies')
        and period_covers_course(p_period_id, c.id)
    );
end;
$$;
