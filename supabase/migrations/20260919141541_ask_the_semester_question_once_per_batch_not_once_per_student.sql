/*
  Three functions asked "which semester is this batch in?" 167 times to learn
  one answer.

  Each wrote it the same reasonable way: take the distinct batch years, then
  keep the one whose current_semester_for_batch() matches. There is only one
  batch, so that should be one call. But these are simple enough for the
  planner to see through, and it pushed the filter down beneath the DISTINCT
  — onto the scan over students — so the function ran once for every student
  before the duplicates were collapsed. EXPLAIN showed it plainly:

      Seq Scan on students  (rows=167)
        Filter: ... AND (current_semester_for_batch(batch_year) = 7)

  batch_currently_in_semester took 949ms; with the fence below, 7ms. It runs
  every time an admin changes the semester in the enrolment form. The two
  enrolment counts had the same shape inside their "sitting" CTE, which is
  where their 740ms per period was going — and the Enrolment page asks for one
  per period.

  "offset 0" is the fence. A subquery with an OFFSET cannot have predicates
  pushed into it, so the DISTINCT runs first and the expensive function sees
  one row per batch. It looks like a no-op, which is exactly why it is
  commented every time it appears: someone tidying this later would be right
  to delete it if they did not know what it holds back.

  current_semester_for_batch itself was left alone. A rewrite was measured —
  5.07ms to 4.45ms per call — and is not worth a second definition of how a
  batch's semester is decided. The cost was never the function; it was being
  asked 167 times.
*/

create or replace function public.batch_currently_in_semester(p_semester integer)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.batch_year
    from (select distinct s.batch_year
            from public.students s
           where s.role = 'student' and s.batch_year is not null
          -- Fence: keeps the planner from evaluating the function below per
          -- student. See the migration comment before removing it.
          offset 0) b
   where public.current_semester_for_batch(b.batch_year) = p_semester
   order by b.batch_year desc
   limit 1;
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
      from (select distinct sc.batch_year from scope sc
            offset 0) b  -- fence: one call per batch, not per student
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
    select s.id, s.batch_year
      from public.students s
     where s.role = 'student'
       and (v_period_dept is null or s.department = v_period_dept)
       and (v_is_super or s.department = v_scope_dept)
  ),
  sitting as (
    select b.batch_year
      from (select distinct sc.batch_year from scope sc
            offset 0) b  -- fence: one call per batch, not per student
     where public.current_semester_for_batch(b.batch_year) = v_semester
  ),
  on_schedule as (
    select count(*)::int n
      from scope sc
     where exists (select 1 from sitting si where si.batch_year = sc.batch_year)
  ),
  repeating as (
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