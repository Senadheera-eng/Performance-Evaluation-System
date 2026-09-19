-- align_offering_student_count_with_roster
-- Applied 20260808115709
-- Exported from the live project; do not edit by hand.

-- The student count on an offering was counted from `enrollments` alone,
-- which disagreed with the roster the same page shows: semesters 1-6 were
-- bulk-imported straight into `results` and have far fewer enrollment rows
-- than result rows, so a fully-taught course read as "0 enrolled" next to a
-- roster of 41 names.
--
-- Both now count the same population the roster does — a student with an
-- enrolment OR a result on the offering — so the number and the list can
-- never contradict each other.

create or replace function public.offering_student_count(p_offering_id uuid)
returns integer
language sql
stable security definer
set search_path to 'public'
as $$
  select count(*)::int from (
    select e.student_id
      from public.enrollments e
      join public.course_offerings o on o.id = p_offering_id
     where e.course_id = o.course_id
       and e.academic_year = o.academic_year
       and e.status = 'enrolled'
    union
    select r.student_id
      from public.results r
     where r.offering_id = p_offering_id
  ) s;
$$;

revoke execute on function public.offering_student_count(uuid) from public, anon;
grant  execute on function public.offering_student_count(uuid) to authenticated;

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
         public.offering_student_count(o.id),
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
         public.offering_student_count(o.id)
    from public.course_offerings o
    join public.courses c on c.id = o.course_id
   where (v_is_super or o.department = v_department)
     and (p_batch_year is null or o.batch_year = p_batch_year)
     and (p_semester   is null or o.semester   = p_semester)
   order by o.batch_year desc, c.semester desc, c.course_code;
end;
$$;

revoke execute on function public.get_my_teaching()                        from public, anon;
revoke execute on function public.get_department_teaching(integer, integer) from public, anon;
grant  execute on function public.get_my_teaching()                        to authenticated;
grant  execute on function public.get_department_teaching(integer, integer) to authenticated;
