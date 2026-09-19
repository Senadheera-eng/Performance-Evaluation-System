/*
  Three things a student asks about that the assistant could not read.

  The AI Assistant page advertised "Attendance Alerts", the project report's
  headline example is "What courses do I need for the Data Management minor?",
  and neither had anything behind it. The assistant had eight tools and none
  of them touched attendance, minors or medical certificates, so the honest
  answer was "I cannot see that yet" — which is better than guessing, but it
  is not an answer.

  All three are SECURITY DEFINER and resolve the student from auth.uid(),
  filtering every read on it. That is deliberate and it is the lesson from
  calculate_gpa_target, which was left as INVOKER and silently returned zero
  for every student because a student has no direct read on `results`.

  Each returns everything about its subject in one call. The Gemini free tier
  allows twenty requests a DAY and every tool turn is a request, so a coarse
  tool that answers a whole question beats three fine ones that need three
  turns to do the same.
*/

-- ---------------------------------------------------------------- attendance

create or replace function public.get_my_attendance()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_student uuid := auth.uid();
  v_threshold numeric;
  v_prewarn numeric;
  v_courses jsonb;
  v_present int; v_absent int; v_excused int; v_total int;
  v_pct numeric;
begin
  select coalesce((value #>> '{}')::numeric, 80) into v_threshold
    from system_settings where key = 'attendance_threshold';
  select coalesce((value #>> '{}')::numeric, 85) into v_prewarn
    from system_settings where key = 'attendance_prewarning_threshold';

  select
    count(*) filter (where a.status = 'present'),
    count(*) filter (where a.status = 'absent'),
    count(*) filter (where a.status = 'excused'),
    count(*)
  into v_present, v_absent, v_excused, v_total
  from attendance a
  where a.student_id = v_student;

  -- Excused counts toward compliance exactly as present does, matching how
  -- the Attendance page and the admin register both treat it.
  v_pct := case when v_total > 0
                then round(((v_present + v_excused)::numeric / v_total) * 100, 1)
                else null end;

  select jsonb_agg(x order by x ->> 'course_code')
    into v_courses
  from (
    select jsonb_build_object(
             'course_code', c.course_code,
             'title', c.title,
             'present', count(*) filter (where a.status = 'present'),
             'absent',  count(*) filter (where a.status = 'absent'),
             'excused', count(*) filter (where a.status = 'excused'),
             'lectures', count(*),
             'percentage', round(
               ((count(*) filter (where a.status in ('present','excused')))::numeric
                 / nullif(count(*), 0)) * 100, 1)
           ) as x
      from attendance a
      join courses c on c.id = a.course_id
     where a.student_id = v_student
     group by c.course_code, c.title
  ) t;

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
    'by_course', coalesce(v_courses, '[]'::jsonb)
  );
end;
$$;

-- -------------------------------------------------------------------- minors

create or replace function public.get_my_minor_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_student uuid := auth.uid();
  v_department text;
  v_minors jsonb;
begin
  select department into v_department from students where id = v_student;

  select jsonb_agg(m order by m ->> 'minor')
    into v_minors
  from (
    select jsonb_build_object(
             'minor', mr.minor,
             'required_credits', mr.required_credits,
             'credits_earned', coalesce(sum(
               case when r.grade is not null and r.grade not in ('R','F','L')
                    then c.credits else 0 end), 0),
             'credits_available', coalesce(sum(c.credits), 0),
             'complete', coalesce(sum(
               case when r.grade is not null and r.grade not in ('R','F','L')
                    then c.credits else 0 end), 0) >= mr.required_credits,
             'courses', jsonb_agg(jsonb_build_object(
               'course_code', c.course_code,
               'title', c.title,
               'credits', c.credits,
               'semester', c.semester,
               'my_grade', r.grade,
               'passed', r.grade is not null and r.grade not in ('R','F','L')
             ) order by c.semester, c.course_code)
           ) as m
      from minor_requirements mr
      join courses c
        on c.department = mr.department
       and c.minor_category = mr.minor
      left join results r
        on r.course_id = c.id
       and r.student_id = v_student
       and r.is_published
     where mr.department = v_department
     group by mr.minor, mr.required_credits
  ) t;

  return jsonb_build_object(
    'department', v_department,
    'minors', coalesce(v_minors, '[]'::jsonb),
    'note', case when v_minors is null
      then 'This department has not published any minor streams.'
      else 'A minor is claimed by passing enough credits from its listed courses.'
      end
  );
end;
$$;

-- ------------------------------------------------------------------ medicals

create or replace function public.get_my_medical_submissions()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_student uuid := auth.uid();
  v_rows jsonb;
begin
  select jsonb_agg(s order by s ->> 'submitted_at' desc)
    into v_rows
  from (
    select jsonb_build_object(
             'submitted_at', ms.submitted_at,
             'missed_from', ms.missed_date,
             'missed_to', ms.end_date,
             'reason_type', ms.reason_type,
             'overall_status', ms.status,
             'deadline', ms.deadline,
             'review_notes', ms.review_notes,
             'courses', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'course_code', c.course_code,
                        'title', c.title,
                        'decision', msc.review_status,
                        'notes', msc.review_notes
                      ) order by c.course_code), '[]'::jsonb)
                 from medical_submission_courses msc
                 join courses c on c.id = msc.course_id
                where msc.submission_id = ms.id
             )
           ) as s
      from medical_submissions ms
     where ms.student_id = v_student
  ) t;

  return jsonb_build_object(
    'submissions', coalesce(v_rows, '[]'::jsonb),
    'note', 'Each module on a certificate is reviewed separately, so one submission can be approved for some modules and rejected for others.'
  );
end;
$$;

revoke execute on function public.get_my_attendance()           from public, anon;
revoke execute on function public.get_my_minor_progress()       from public, anon;
revoke execute on function public.get_my_medical_submissions()  from public, anon;

grant execute on function public.get_my_attendance()          to authenticated, service_role;
grant execute on function public.get_my_minor_progress()      to authenticated, service_role;
grant execute on function public.get_my_medical_submissions() to authenticated, service_role;
