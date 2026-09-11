/*
  Expanding a window as the Super Admin timed out: 32 seconds for 47 courses,
  against an 8 second limit. A department admin never saw it because their
  scope is 42 students; the faculty's is 167.

  The cost was one line. eligible_count asked, for every student under every
  course, "is this student's batch currently in the window's semester?" —
  current_semester_for_batch, which scans every published result to answer.
  167 students times 47 courses is 7,849 scans of the results table to learn
  eight facts, because a batch is a batch whichever course you ask under.

  So ask once per batch, not once per student per course, and split the count
  the way the question is actually shaped: everyone in a batch that is sitting
  this semester (the same number under every course), plus the repeaters, who
  are the only part that varies by course. Same answer, one pass.

  Measured on this data: 32.3s -> well under a second.
*/

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
  with scope as (
    -- The students this caller may count at all.
    select s.id, s.batch_year
      from public.students s
     where s.role = 'student'
       and (v_period_dept is null or s.department = v_period_dept)
       and (v_is_super or s.department = v_scope_dept)
  ),
  sitting as (
    -- Eight rows at most, and the only place the expensive question is asked.
    select b.batch_year
      from (select distinct sc.batch_year from scope sc) b
     where public.current_semester_for_batch(b.batch_year) = v_semester
  ),
  on_schedule as (
    -- Eligible under every course in the window, so counted once.
    select count(*)::int n
      from scope sc
     where exists (select 1 from sitting si where si.batch_year = sc.batch_year)
  ),
  repeating as (
    -- The part that does vary by course: a student outside the sitting batches
    -- who failed this one and must take it again.
    select r.course_id, count(distinct r.student_id)::int n
      from public.results r
      join scope sc on sc.id = r.student_id
     where r.is_published
       and r.grade in ('R','L')
       and not exists (select 1 from sitting si where si.batch_year = sc.batch_year)
     group by r.course_id
  ),
  enrolled as (
    select e.course_id, count(distinct e.student_id)::int n
      from public.enrollments e
      join scope sc on sc.id = e.student_id
     where e.status = 'enrolled'
       and (v_batch is null
            or coalesce(e.enrolled_with_batch, sc.batch_year) = v_batch)
     group by e.course_id
  )
  select c.id, c.course_code, c.title, epc.capacity,
         (select n from on_schedule) + coalesce(rp.n, 0),
         coalesce(en.n, 0)
    from public.courses c
    left join public.enrollment_period_courses epc
      on epc.period_id = p_period_id and epc.course_id = c.id
    left join repeating rp on rp.course_id = c.id
    left join enrolled  en on en.course_id = c.id
   where (v_is_super
          or c.department = v_scope_dept
          or c.department = 'Interdisciplinary Studies')
     and public.period_covers_course(p_period_id, c.id)
   order by c.course_code;
end;
$$;

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
  with scope as (
    select s.id, s.batch_year
      from public.students s
     where s.role = 'student'
       and (v_period_dept is null or s.department = v_period_dept)
       and (v_is_super or s.department = v_scope_dept)
  ),
  sitting as (
    select b.batch_year
      from (select distinct sc.batch_year from scope sc) b
     where public.current_semester_for_batch(b.batch_year) = v_semester
  ),
  eligible as (
    select count(*)::int n
      from scope sc
     where exists (select 1 from sitting si where si.batch_year = sc.batch_year)
        or exists (select 1 from public.results r
                    where r.student_id = sc.id and r.is_published
                      and r.grade in ('R','L')
                      and public.period_covers_course(p_period_id, r.course_id))
  ),
  enrolled as (
    select count(distinct e.student_id)::int n
      from public.enrollments e
      join scope sc on sc.id = e.student_id
      join public.courses c on c.id = e.course_id
     where e.status = 'enrolled'
       and (v_batch is null
            or coalesce(e.enrolled_with_batch, sc.batch_year) = v_batch)
       and (v_is_super
            or c.department = v_scope_dept
            or c.department = 'Interdisciplinary Studies')
       and public.period_covers_course(p_period_id, c.id)
  )
  select (select n from eligible), (select n from enrolled);
end;
$$;
