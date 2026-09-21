-- A student's deliveries were taken from their enrolments alone, so a course
-- they had been marked present in but were no longer enrolled on vanished
-- from their attendance page entirely — the register said they were there and
-- the page said no lectures had been recorded.
--
-- The register is a fact in its own right. A delivery therefore exists if the
-- student enrolled on it OR was marked in it, which is the same rule
-- offering_roster_ids already applies to a roster (enrolled, or has a result).
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

  with taken as (
    select e.course_id, e.academic_year, e.status, e.enrollment_kind,
           e.enrolled_with_batch
      from enrollments e
     where e.student_id = v_student
       and e.status <> 'dropped'
    union
    /* Marked in the register but not enrolled: the lecture happened, so it
       counts. Nothing is known about how they came to be on it, so the
       enrolment fields stay empty rather than being invented. */
    select o.course_id, o.academic_year, null::text, null::text, o.batch_year
      from attendance a
      join course_offerings o on o.id = a.offering_id
     where a.student_id = v_student
       and not exists (
         select 1 from enrollments e2
          where e2.student_id = v_student
            and e2.course_id = o.course_id
            and e2.academic_year = o.academic_year
            and e2.status <> 'dropped')
     group by o.course_id, o.academic_year, o.batch_year
  ),
  delivery as (
    select t.*,
           c.course_code, c.title, c.semester,
           row_number() over (partition by t.course_id
                              order by t.academic_year) as attempt_number,
           row_number() over (partition by t.course_id
                              order by t.academic_year desc) = 1 as is_latest_attempt,
           count(*) over (partition by t.course_id) > 1 as has_repeat
      from taken t
      join courses c on c.id = t.course_id
  ),
  /* The register is tied to the delivery through the offering's year, which
     is the same year the student enrolled for. */
  session as (
    select a.course_id, o.academic_year, a.lecture_date, a.status
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
             'is_repeat', coalesce(enrollment_kind, 'regular') <> 'regular',
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
