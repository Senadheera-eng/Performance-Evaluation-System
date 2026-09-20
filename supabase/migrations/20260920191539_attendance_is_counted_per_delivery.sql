-- Attendance belongs to a delivery, not to a course.
--
-- A student who repeats a course sits it twice, with its own register each
-- time. Counting both together produced one percentage that described neither:
-- a bad first attempt dragged the repeat below the requirement for ever, and
-- a good repeat could hide a first attempt the student was excluded from.
--
-- An enrolment is already one delivery — unique on (student, course, year) —
-- so it is what the register is grouped by here.

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
                                else null end)
           order by is_latest_attempt desc, course_code, academic_year desc)
    into v_deliveries
    from counted;

  return jsonb_build_object(
    'threshold_percent', v_threshold,
    'prewarning_percent', v_prewarn,
    'deliveries', coalesce(v_deliveries, '[]'::jsonb));
end;
$$;

revoke all on function public.get_my_attendance_detail() from public;
grant execute on function public.get_my_attendance_detail() to authenticated;

comment on function public.get_my_attendance_detail() is
  'This student''s attendance, one entry per delivery of a course: a repeated course appears once per attempt, each with its own register and percentage.';


-- The assistant's summary follows the same rule: a superseded attempt is
-- history and is reported as such rather than being averaged into the
-- percentage the student is judged on.
create or replace function public.get_my_attendance()
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
  v_detail jsonb;
  v_courses jsonb;
  v_present int; v_absent int; v_excused int; v_total int;
  v_pct numeric;
begin
  v_detail := public.get_my_attendance_detail();
  v_threshold := (v_detail ->> 'threshold_percent')::numeric;
  v_prewarn := (v_detail ->> 'prewarning_percent')::numeric;

  select coalesce(sum((d ->> 'present')::int), 0),
         coalesce(sum((d ->> 'absent')::int), 0),
         coalesce(sum((d ->> 'excused')::int), 0),
         coalesce(sum((d ->> 'lectures')::int), 0)
    into v_present, v_absent, v_excused, v_total
    from jsonb_array_elements(v_detail -> 'deliveries') d
   where (d ->> 'is_latest_attempt')::boolean;

  v_pct := case when v_total > 0
                then round(((v_present + v_excused)::numeric / v_total) * 100, 1)
                else null end;

  select jsonb_agg(
           jsonb_build_object(
             'course_code', d ->> 'course_code',
             'title', d ->> 'title',
             'academic_year', d ->> 'academic_year',
             'attempt', case when (d ->> 'has_repeat')::boolean
                             then 'attempt ' || (d ->> 'attempt_number')
                                  || case when (d ->> 'is_latest_attempt')::boolean
                                          then ' (the one that counts)'
                                          else ' (superseded by a later attempt)' end
                        end,
             'present', (d ->> 'present')::int,
             'absent', (d ->> 'absent')::int,
             'excused', (d ->> 'excused')::int,
             'lectures', (d ->> 'lectures')::int,
             'percentage', (d ->> 'percentage')::numeric)
           order by d ->> 'course_code', d ->> 'academic_year')
    into v_courses
    from jsonb_array_elements(v_detail -> 'deliveries') d;

  return jsonb_build_object(
    'threshold_percent', v_threshold,
    'prewarning_percent', v_prewarn,
    'overall_percentage', v_pct,
    'lectures_recorded', v_total,
    'present', v_present,
    'absent', v_absent,
    'excused', v_excused,
    'status', case
      when v_total = 0 then 'no attendance recorded yet'
      when v_pct < v_threshold then 'below the required minimum'
      when v_pct < v_prewarn then 'above the minimum but close to it'
      else 'comfortably above the minimum' end,
    'by_course', coalesce(v_courses, '[]'::jsonb));
end;
$$;;
