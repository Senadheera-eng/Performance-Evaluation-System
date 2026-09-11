/*
  "0 of 41 enrolled" on a window that had an enrolment in it.

  The same hand-typed academic_year that hid students from the Results page was
  still deciding the counts on the Enrolment screen. The three windows for
  semester 7 of batch 2021 carry 2026/2027 and 2021/2022 between them, while
  the enrolments they produced are filed under the derived 2024/2025 — so every
  count came back zero, and the course breakdown under each window did too.

  Match on the batch instead. An enrolment row already records which batch it
  was sat with (enrolled_with_batch, null meaning the student's own), and a
  window already records which batch it is aimed at. Comparing those two is the
  question actually being asked — "who enrolled in this window" — and it needs
  no year arithmetic to answer, so there is nothing left to type wrong.

  A repeat-only window names no batch. It filters on none, which is right: its
  students each sit with a different one.

  enrollment_periods.academic_year stays on the screen as the label the
  department typed. It no longer counts anything.
*/

create or replace function public.get_enrollment_period_summary(p_period_id uuid)
returns table(eligible_count integer, enrolled_count integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_is_super    boolean;
  v_scope_dept  text;
  v_period_dept text;
  v_semester    integer;
  v_batch       integer;
  v_found       boolean;
begin
  select o.is_super, o.department into v_is_super, v_scope_dept
    from public.enrolment_oversight() o;

  if not v_is_super and v_scope_dept is null then
    raise exception 'Access denied: enrolment oversight required';
  end if;

  select true, p.department, p.semester, p.batch_year
    into v_found, v_period_dept, v_semester, v_batch
    from public.enrollment_periods p where p.id = p_period_id;

  if not coalesce(v_found, false) then
    raise exception 'Enrollment period not found';
  end if;

  return query
  select
    (select count(*)::int from public.students s
      where s.role = 'student'
        and (v_period_dept is null or s.department = v_period_dept)
        and (v_is_super or s.department = v_scope_dept)
        and (
          public.current_semester_for_batch(s.batch_year) = v_semester
          or exists (select 1 from public.results r
                      where r.student_id = s.id and r.is_published
                        and r.grade in ('R','L')
                        and public.period_covers_course(p_period_id, r.course_id))
        )
    ),
    (select count(distinct e.student_id)::int from public.enrollments e
      join public.students s on s.id = e.student_id
      join public.courses  c on c.id = e.course_id
      where e.status = 'enrolled'
        and (v_batch is null
             or coalesce(e.enrolled_with_batch, s.batch_year) = v_batch)
        and (v_period_dept is null or s.department = v_period_dept)
        and (v_is_super or s.department = v_scope_dept)
        and (v_is_super
             or c.department = v_scope_dept
             or c.department = 'Interdisciplinary Studies')
        and public.period_covers_course(p_period_id, c.id)
    );
end;
$$;

create or replace function public.get_enrollment_period_course_stats(p_period_id uuid)
returns table(
  course_id uuid,
  course_code text,
  course_title text,
  capacity integer,
  eligible_count integer,
  enrolled_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_is_super    boolean;
  v_scope_dept  text;
  v_period_dept text;
  v_semester    integer;
  v_batch       integer;
  v_found       boolean;
begin
  select o.is_super, o.department into v_is_super, v_scope_dept
    from public.enrolment_oversight() o;

  if not v_is_super and v_scope_dept is null then
    raise exception 'Access denied: enrolment oversight required';
  end if;

  select true, p.department, p.semester, p.batch_year
    into v_found, v_period_dept, v_semester, v_batch
    from public.enrollment_periods p where p.id = p_period_id;

  if not coalesce(v_found, false) then
    raise exception 'Enrollment period not found';
  end if;

  return query
  select
    c.id, c.course_code, c.title, epc.capacity,
    (select count(*)::int from public.students s
      where s.role = 'student'
        and (v_period_dept is null or s.department = v_period_dept)
        and (v_is_super or s.department = v_scope_dept)
        and (
          public.current_semester_for_batch(s.batch_year) = v_semester
          or exists (select 1 from public.results r
                      where r.student_id = s.id and r.course_id = c.id
                        and r.is_published and r.grade in ('R','L'))
        )
    ),
    (select count(distinct e.student_id)::int from public.enrollments e
      join public.students s on s.id = e.student_id
      where e.status = 'enrolled'
        and e.course_id = c.id
        and (v_batch is null
             or coalesce(e.enrolled_with_batch, s.batch_year) = v_batch)
        and (v_period_dept is null or s.department = v_period_dept)
        and (v_is_super or s.department = v_scope_dept)
    )
  from public.courses c
  left join public.enrollment_period_courses epc
    on epc.period_id = p_period_id and epc.course_id = c.id
  where (v_is_super
         or c.department = v_scope_dept
         or c.department = 'Interdisciplinary Studies')
    and public.period_covers_course(p_period_id, c.id)
  order by c.course_code;
end;
$$;

create or replace function public.get_course_enrolled_students(
  p_course_id uuid,
  p_batch_year integer default null
)
returns table(
  student_id uuid,
  name text,
  index_number text,
  reg_number text,
  batch_year integer,
  department text,
  status text,
  enrolled_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_is_super boolean;
  v_scope_dept text;
  v_course_dept text;
  v_student_dept_filter text;
begin
  select o.is_super, o.department into v_is_super, v_scope_dept
    from public.enrolment_oversight() o;

  if not v_is_super and v_scope_dept is null then
    raise exception 'Access denied: enrolment oversight required';
  end if;

  select c.department into v_course_dept
  from public.courses c where c.id = p_course_id;
  if v_course_dept is null then
    raise exception 'Course not found';
  end if;

  if not v_is_super then
    if v_course_dept is distinct from v_scope_dept
       and v_course_dept <> 'Interdisciplinary Studies' then
      raise exception 'Access denied: course belongs to another department';
    end if;
    v_student_dept_filter := v_scope_dept;
  end if;

  return query
  select s.id, s.name, s.index_number, s.reg_number, s.batch_year,
         s.department, e.status, e.enrolled_at
  from public.enrollments e
  join public.students s on s.id = e.student_id
  where e.course_id = p_course_id and e.status = 'enrolled'
    and (p_batch_year is null
         or coalesce(e.enrolled_with_batch, s.batch_year) = p_batch_year)
    and (v_student_dept_filter is null or s.department = v_student_dept_filter)
  order by s.name;
end;
$$;
