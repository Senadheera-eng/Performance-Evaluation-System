-- The admin's student list follows the same rule as the student's own record:
-- a course sat twice is one course, and its attendance is the register of the
-- delivery being sat now rather than both terms averaged together.
create or replace function public.get_all_students_academic_stats()
returns table (
  student_id uuid,
  cgpa numeric,
  total_gpa_credits integer,
  avg_attendance integer,
  attendance_total integer,
  enrolled_courses integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if get_my_role() not in ('dept_admin', 'super_admin') then
    raise exception 'Access denied: admin role required';
  end if;

  return query
  with gpa_calc as (
    -- A superseded attempt carries no grade point, so a repeated course's
    -- credits are counted once here without having to be excluded.
    select r.student_id as sid,
           sum(r.gpv * c.credits) filter (where c.contributes_to_gpa) as weighted,
           sum(c.credits)         filter (where c.contributes_to_gpa) as credits
    from results r
    join courses c on c.id = r.course_id
    where r.is_published and r.gpv is not null
    group by r.student_id
  ),
  delivery as (
    select a.student_id as sid, a.status,
           dense_rank() over (partition by a.student_id, a.course_id
                              order by o.academic_year desc) = 1 as is_latest
    from attendance a
    join course_offerings o on o.id = a.offering_id
  ),
  att_calc as (
    select d.sid,
           count(*) filter (where d.status in ('present', 'excused')) as present,
           count(*) as total
    from delivery d
    where d.is_latest
    group by d.sid
  ),
  enroll_calc as (
    select e.student_id as sid, count(distinct e.course_id) as cnt
    from enrollments e
    where e.status = 'enrolled'
    group by e.student_id
  )
  select s.id,
         round((g.weighted / nullif(g.credits, 0))::numeric, 2),
         g.credits::int,
         case when a.total > 0
              then round((a.present::numeric / a.total) * 100)::int else 0 end,
         coalesce(a.total, 0)::int,
         coalesce(en.cnt, 0)::int
  from students s
  left join gpa_calc g on g.sid = s.id
  left join att_calc a on a.sid = s.id
  left join enroll_calc en on en.sid = s.id
  where s.role = 'student';
end;
$$;;
