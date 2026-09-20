-- Which semester a batch is in now, and therefore which of a lecturer's
-- courses they are teaching now.
--
-- An offering is a course as delivered to one batch in one academic year, so
-- the facts were always here; nothing exposed them. A lecturer's course list
-- showed every offering they had ever been assigned to — for Batch 7, now in
-- Semester 7, that put Semester 5 and 6 courses finished two years ago beside
-- the current ones with nothing to tell them apart. Every screen then had to
-- guess, and each guessed differently.
--
-- The rule, stated once: an offering is current when its semester is the one
-- its batch is sitting now. Past offerings are still returned — a repeat
-- student, a late result, a feedback round opened after the fact — but they
-- now say what they are, and they sort below the current ones.

drop function if exists public.get_my_teaching();
create function public.get_my_teaching()
returns table (
  offering_id uuid, course_id uuid, course_code text, course_title text,
  credits integer, semester integer, academic_year text, batch_year integer,
  department text, my_role text, co_lecturers jsonb, enrolled_count integer,
  draft_count integer, submitted_count integer, published_count integer,
  batch_current_semester integer, is_current boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lecturer uuid;
begin
  v_lecturer := public.my_lecturer_id();
  if v_lecturer is null then
    return;
  end if;

  return query
  with mine as (
    select o.id, o.academic_year, o.batch_year, o.department,
           cl.assignment_role, o.course_id
      from public.course_lecturers cl
      join public.course_offerings o on o.id = cl.offering_id
     where cl.lecturer_id = v_lecturer and cl.is_active
  ),
  -- One call per batch rather than one per offering.
  batch_now as (
    select b.batch_year, public.current_semester_for_batch(b.batch_year) as sem
      from (select distinct m.batch_year from mine m offset 0) b
  )
  select m.id, c.id, c.course_code, c.title, c.credits, c.semester,
         m.academic_year, m.batch_year, m.department,
         m.assignment_role,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'lecturer_id', l2.id,
                    'name', coalesce(l2.title || ' ', '') || l2.name,
                    'assignment_role', cl2.assignment_role)
                  order by cl2.assignment_role desc, l2.name)
             from public.course_lecturers cl2
             join public.lecturers l2 on l2.id = cl2.lecturer_id
            where cl2.offering_id = m.id and cl2.is_active
              and cl2.lecturer_id <> v_lecturer
         ), '[]'::jsonb),
         public.offering_student_count(m.id),
         (select count(*)::int from public.results r where r.offering_id = m.id and r.status = 'draft'),
         (select count(*)::int from public.results r where r.offering_id = m.id and r.status = 'submitted'),
         (select count(*)::int from public.results r where r.offering_id = m.id and r.status = 'published'),
         bn.sem,
         coalesce(c.semester = bn.sem, false)
    from mine m
    join public.courses c on c.id = m.course_id
    left join batch_now bn on bn.batch_year = m.batch_year
   order by coalesce(c.semester = bn.sem, false) desc,
            m.batch_year desc, c.semester desc, c.course_code;
end;
$$;
revoke all on function public.get_my_teaching() from public, anon;
grant execute on function public.get_my_teaching() to authenticated;

-- The head of department's list of the same thing, with the same two
-- columns added. Scope, filters and ordering are otherwise unchanged.
drop function if exists public.get_department_teaching(integer, integer);
create function public.get_department_teaching(
  p_batch_year integer default null,
  p_semester integer default null
)
returns table (
  offering_id uuid, course_id uuid, course_code text, course_title text,
  credits integer, category text, semester integer, academic_year text,
  batch_year integer, department text, lecturers jsonb, enrolled_count integer,
  batch_current_semester integer, is_current boolean
)
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
  v_department := public.my_staff_department();

  if not v_is_super and v_department is null then
    raise exception 'No department scope for this account';
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
revoke all on function public.get_department_teaching(integer, integer) from public, anon;
grant execute on function public.get_department_teaching(integer, integer) to authenticated;