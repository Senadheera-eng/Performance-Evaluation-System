-- An attendance alert names a student who is about to lose eligibility in a
-- course they are sitting now.
--
-- Grouping their register by course alone merged a repeated course's two
-- terms into a single percentage that described neither: a student who failed
-- on attendance two years ago and is attending everything this time still
-- read as below the line, and a good first attempt could hide a bad repeat.
-- The register is grouped by delivery, and the alert reports the delivery the
-- student is enrolled in.
create or replace function public.get_admin_attendance_overview(
  p_alert_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_my_role();
  v_dept text := get_my_department();
  v_result jsonb;
begin
  if v_role not in ('dept_admin', 'super_admin') then
    raise exception 'Access denied: admin role required';
  end if;

  with scoped_courses as (
    select c.id, c.course_code, c.title, c.semester
      from courses c
     where v_role = 'super_admin' or c.department = v_dept
  ),
  att as (
    select a.student_id, a.course_id, o.academic_year,
           count(*) as total,
           count(*) filter (where a.status in ('present', 'excused')) as present
      from attendance a
      join scoped_courses sc on sc.id = a.course_id
      join course_offerings o on o.id = a.offering_id
     group by a.student_id, a.course_id, o.academic_year
  ),
  per_course as (
    select sc.id, sc.course_code, sc.semester,
           sum(att.total) as total, sum(att.present) as present
      from scoped_courses sc
      left join att on att.course_id = sc.id
     group by sc.id, sc.course_code, sc.semester
  ),
  alerts as (
    select s.name, s.reg_number, sc.course_code, sc.title,
           att.academic_year,
           round(att.present * 100.0 / att.total)::int as pct
      from att
      join enrollments e on e.student_id = att.student_id
                        and e.course_id = att.course_id
                        and e.academic_year = att.academic_year
                        and e.status = 'enrolled'
      join students s on s.id = att.student_id
      join scoped_courses sc on sc.id = att.course_id
     where att.present * 100.0 / att.total < 79.5
     order by att.present::numeric / att.total, s.reg_number
     limit p_alert_limit
  )
  select jsonb_build_object(
    'average', (select case when sum(total) > 0
                            then round(sum(present) * 100.0 / sum(total))::int
                            else 0 end from att),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object(
                 'studentName', name, 'regNumber', reg_number,
                 'courseCode', course_code, 'courseName', title,
                 'academicYear', academic_year,
                 'percentage', pct) order by pct, reg_number) from alerts), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_build_object(
                 'code', course_code,
                 'avgAttendance', round(present * 100.0 / total)::int)
                 order by semester, course_code)
                 from per_course where total > 0), '[]'::jsonb),
    'awaiting', (select count(*) from per_course where coalesce(total, 0) = 0)
  ) into v_result;

  return v_result;
end;
$$;;
