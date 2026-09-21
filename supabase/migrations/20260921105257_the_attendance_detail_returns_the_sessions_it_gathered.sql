-- The register of each delivery was gathered and then dropped on the floor:
-- `sessions` was computed in the CTE but never written into the object that
-- comes back, so every delivery arrived without it and the page that maps
-- over a delivery's lectures had nothing to map over.
create or replace function public.get_my_attendance_detail()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student uuid := auth.uid();
  v_threshold numeric;
  v_prewarn numeric;
  v_deliveries jsonb;
begin
  select coalesce((value #>> '{}')::numeric, 80) into v_threshold
    from system_settings where key = 'attendance_threshold';
  select coalesce((value #>> '{}')::numeric, 85) into v_prewarn
    from system_settings where key = 'attendance_prewarning_threshold';

  with delivery as (
    select e.course_id,
           e.academic_year,
           e.status,
           e.enrollment_kind,
           e.enrolled_with_batch,
           c.course_code,
           c.title,
           c.semester,
           row_number() over (partition by e.course_id
                              order by e.academic_year) as attempt_number,
           row_number() over (partition by e.course_id
                              order by e.academic_year desc) = 1 as is_latest_attempt,
           count(*) over (partition by e.course_id) > 1 as has_repeat
      from enrollments e
      join courses c on c.id = e.course_id
     where e.student_id = v_student
       and e.status <> 'dropped'
  ),
  /* The register is tied to the delivery through the offering's year, which
     is the same year the student enrolled for. */
  session as (
    select a.course_id,
           o.academic_year,
           a.lecture_date,
           a.status
      from attendance a
      join course_offerings o on o.id = a.offering_id
     where a.student_id = v_student
  ),
  counted as (
    select d.*,
           count(s.*) filter (where s.status = 'present') as present,
           count(s.*) filter (where s.status = 'absent')  as absent,
           count(s.*) filter (where s.status = 'excused') as excused,
           count(s.*) as lectures,
           coalesce(
             jsonb_agg(jsonb_build_object('date', s.lecture_date, 'status', s.status)
                       order by s.lecture_date)
             filter (where s.lecture_date is not null), '[]'::jsonb) as sessions
      from delivery d
      left join session s
        on s.course_id = d.course_id
       and s.academic_year = d.academic_year
     group by d.course_id, d.academic_year, d.status, d.enrollment_kind,
              d.enrolled_with_batch, d.course_code, d.title, d.semester,
              d.attempt_number, d.is_latest_attempt, d.has_repeat
  )
  select jsonb_agg(
           jsonb_build_object(
             'delivery_key', course_id::text || ':' || academic_year,
             'course_id', course_id,
             'course_code', course_code,
             'title', title,
             'semester', semester,
             'academic_year', academic_year,
             'enrolled_with_batch', enrolled_with_batch,
             'is_repeat', enrollment_kind <> 'regular',
             'attempt_number', attempt_number,
             'is_latest_attempt', is_latest_attempt,
             'has_repeat', has_repeat,
             'in_progress', status = 'enrolled',
             'present', present,
             'absent', absent,
             'excused', excused,
             'lectures', lectures,
             -- Excused counts toward compliance exactly as present does.
             'percentage', case when lectures > 0
                                then round(((present + excused)::numeric / lectures) * 100, 1)
                                else null end,
             -- The lectures themselves, which the calendar and the history
             -- list are both drawn from.
             'sessions', sessions)
           order by is_latest_attempt desc, course_code, academic_year desc)
    into v_deliveries
    from counted;

  return jsonb_build_object(
    'threshold_percent', v_threshold,
    'prewarning_percent', v_prewarn,
    'deliveries', coalesce(v_deliveries, '[]'::jsonb));
end;
$$;;
