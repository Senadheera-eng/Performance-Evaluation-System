/*
  Enrolment oversight, stated once.

  Three functions each carried their own copy of "who may look at enrolment",
  and each copy spelled it `v_role in ('dept_admin','super_admin')`. A head of
  department holds no row in `admins`, so get_my_role() returns '' for them and
  all three refused — which is why the staff portal has no enrolment screen at
  all. Writing the rule in one place is what lets the head in without three
  chances to let them in differently.

  Oversight is read-only by construction: `enrollment_periods` and
  `enrollment_period_courses` carry a single write policy each, for the super
  admin, so a head of department cannot open, schedule or create a window no
  matter what the client sends. Nothing below changes that.
*/

create or replace function public.enrolment_oversight(
  out is_super boolean,
  out department text
)
returns record
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text := public.get_my_role();
begin
  if v_role = 'super_admin' then
    is_super := true;
    department := null;
    return;
  end if;

  is_super := false;

  if v_role = 'dept_admin' then
    department := public.get_my_department();
  else
    -- A lecturer only oversees enrolment while they hold the appointment.
    -- The day it ends, my_hod_department() returns null and so does this.
    department := public.my_hod_department();
  end if;
end;
$$;

comment on function public.enrolment_oversight() is
  'Who may look at enrolment across students: super admin (faculty-wide), '
  'department admin (own department), or the head of that department. '
  'department is null with is_super false means no oversight at all.';

grant execute on function public.enrolment_oversight() to authenticated;


/* ---------- which windows a caller may read ---------- */

create or replace function public.enrollment_period_visible(
  p_department text,
  p_status text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text := public.get_my_role();
  v_dept text;
begin
  if v_role = 'super_admin' then
    return true;
  end if;

  -- A draft is a window still being written. A department admin sees their
  -- own department's so they can prepare for it; nobody else has any business
  -- reading one.
  if p_status = 'draft' and v_role <> 'dept_admin' then
    return false;
  end if;

  if v_role = 'dept_admin' then
    v_dept := public.get_my_department();
  elsif v_role = 'student' then
    v_dept := public.get_my_department();
    -- A first-year has no department yet, so only the faculty-wide windows
    -- can apply to them.
    if v_dept is null then
      return p_department is null;
    end if;
  else
    v_dept := public.my_hod_department();
    -- A lecturer without an appointment has no part in enrolment.
    if v_dept is null then
      return false;
    end if;
  end if;

  return p_department is null or p_department = v_dept;
end;
$$;

grant execute on function public.enrollment_period_visible(text, text) to authenticated;

create or replace function public.can_read_enrollment_period(p_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.enrollment_period_visible(p.department, p.status)
    from public.enrollment_periods p
   where p.id = p_period_id
$$;

grant execute on function public.can_read_enrollment_period(uuid) to authenticated;

/*
  Previously every signed-in account could read every window that was not a
  draft, whatever department it belonged to, and every department admin could
  read every other department's drafts. Scoping the read to the caller's own
  department costs nothing — the student pages reach windows through SECURITY
  DEFINER functions and never touch this policy.
*/
drop policy if exists ep_read_published on public.enrollment_periods;
create policy ep_read_published on public.enrollment_periods
  for select
  using (public.enrollment_period_visible(department, status));

drop policy if exists epc_read_with_period on public.enrollment_period_courses;
create policy epc_read_with_period on public.enrollment_period_courses
  for select
  using (public.can_read_enrollment_period(period_id));


/* ---------- the three oversight reads ---------- */

create or replace function public.get_enrollment_period_summary(p_period_id uuid)
returns table(eligible_count integer, enrolled_count integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_is_super   boolean;
  v_scope_dept text;
  v_period_dept text;
  v_semester   integer;
  v_year       text;
  v_found      boolean;
begin
  select o.is_super, o.department into v_is_super, v_scope_dept
    from public.enrolment_oversight() o;

  if not v_is_super and v_scope_dept is null then
    raise exception 'Access denied: enrolment oversight required';
  end if;

  select true, p.department, p.semester, p.academic_year
    into v_found, v_period_dept, v_semester, v_year
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
        and e.academic_year = v_year
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
  v_is_super   boolean;
  v_scope_dept text;
  v_period_dept text;
  v_semester   integer;
  v_year       text;
  v_found      boolean;
begin
  select o.is_super, o.department into v_is_super, v_scope_dept
    from public.enrolment_oversight() o;

  if not v_is_super and v_scope_dept is null then
    raise exception 'Access denied: enrolment oversight required';
  end if;

  select true, p.department, p.semester, p.academic_year
    into v_found, v_period_dept, v_semester, v_year
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
        and e.academic_year = v_year
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
  v_course_semester integer;
  v_expected_year text;
  v_student_dept_filter text;
begin
  select o.is_super, o.department into v_is_super, v_scope_dept
    from public.enrolment_oversight() o;

  if not v_is_super and v_scope_dept is null then
    raise exception 'Access denied: enrolment oversight required';
  end if;

  select c.department, c.semester into v_course_dept, v_course_semester
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

  if p_batch_year is not null then
    v_expected_year := (p_batch_year + ceil(v_course_semester / 2.0)::int - 1)::text
                        || '/' || (p_batch_year + ceil(v_course_semester / 2.0)::int)::text;
  end if;

  return query
  select s.id, s.name, s.index_number, s.reg_number, s.batch_year,
         s.department, e.status, e.enrolled_at
  from public.enrollments e
  join public.students s on s.id = e.student_id
  where e.course_id = p_course_id and e.status = 'enrolled'
    and (v_expected_year is null or e.academic_year = v_expected_year)
    and (v_student_dept_filter is null or s.department = v_student_dept_filter)
  order by s.name;
end;
$$;
