-- staff_dashboard_rpcs
-- Applied 20260808114835
-- Exported from the live project; do not edit by hand.

/** The department a staff member acts for: the one they head if they are an
 *  HOD, otherwise their admin department. Lecturers with no headship get
 *  their own department, which is what the read-only department views use. */
create or replace function public.my_staff_department()
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_department text;
begin
  v_department := public.my_hod_department();
  if v_department is not null then
    return v_department;
  end if;
  v_department := public.get_my_department();
  if v_department is not null then
    return v_department;
  end if;
  select department into v_department from public.lecturers
   where auth_user_id = auth.uid() and status = 'active';
  return v_department;
end;
$$;

/** Everything the signed-in lecturer teaches, with the co-lecturers on each
 *  offering, the class size and how far its result sheet has got. One call,
 *  because the dashboard needs all of it at once and resolving co-lecturers
 *  or rosters from the client would hit the same RLS walls that made the
 *  admin roster RPCs necessary. */
create or replace function public.get_my_teaching()
returns table (
  offering_id      uuid,
  course_id        uuid,
  course_code      text,
  course_title     text,
  credits          integer,
  semester         integer,
  academic_year    text,
  batch_year       integer,
  department       text,
  my_role          text,
  co_lecturers     jsonb,
  enrolled_count   integer,
  draft_count      integer,
  submitted_count  integer,
  published_count  integer
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_lecturer uuid;
begin
  v_lecturer := public.my_lecturer_id();
  if v_lecturer is null then
    return;
  end if;

  return query
  select o.id, c.id, c.course_code, c.title, c.credits, c.semester,
         o.academic_year, o.batch_year, o.department,
         mine.assignment_role,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'lecturer_id', l2.id,
                    'name', coalesce(l2.title || ' ', '') || l2.name,
                    'assignment_role', cl2.assignment_role)
                  order by cl2.assignment_role desc, l2.name)
             from public.course_lecturers cl2
             join public.lecturers l2 on l2.id = cl2.lecturer_id
            where cl2.offering_id = o.id and cl2.is_active
              and cl2.lecturer_id <> v_lecturer
         ), '[]'::jsonb),
         (select count(*)::int from public.enrollments e
           where e.course_id = o.course_id
             and e.academic_year = o.academic_year
             and e.status = 'enrolled'),
         (select count(*)::int from public.results r where r.offering_id = o.id and r.status = 'draft'),
         (select count(*)::int from public.results r where r.offering_id = o.id and r.status = 'submitted'),
         (select count(*)::int from public.results r where r.offering_id = o.id and r.status = 'published')
    from public.course_lecturers mine
    join public.course_offerings o on o.id = mine.offering_id
    join public.courses c          on c.id = o.course_id
   where mine.lecturer_id = v_lecturer
     and mine.is_active
   order by o.batch_year desc, c.semester desc, c.course_code;
end;
$$;

/** Department offerings with their current teaching staff — the data behind
 *  the HOD's course-assignment screen. Scoped to the caller's own
 *  department; a department admin sees the same view. */
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
  v_is_super := public.get_my_role() = 'super_admin';
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
         (select count(*)::int from public.enrollments e
           where e.course_id = o.course_id
             and e.academic_year = o.academic_year
             and e.status = 'enrolled')
    from public.course_offerings o
    join public.courses c on c.id = o.course_id
   where (v_is_super or o.department = v_department)
     and (p_batch_year is null or o.batch_year = p_batch_year)
     and (p_semester   is null or o.semester   = p_semester)
   order by o.batch_year desc, c.semester desc, c.course_code;
end;
$$;

/** Academic staff available for assignment in the caller's department. */
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
  v_is_super := public.get_my_role() = 'super_admin';
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

revoke execute on function public.my_staff_department()                       from public, anon;
revoke execute on function public.get_my_teaching()                           from public, anon;
revoke execute on function public.get_department_teaching(integer, integer)    from public, anon;
revoke execute on function public.get_assignable_lecturers()                  from public, anon;
grant  execute on function public.my_staff_department()                        to authenticated;
grant  execute on function public.get_my_teaching()                           to authenticated;
grant  execute on function public.get_department_teaching(integer, integer)    to authenticated;
grant  execute on function public.get_assignable_lecturers()                  to authenticated;
