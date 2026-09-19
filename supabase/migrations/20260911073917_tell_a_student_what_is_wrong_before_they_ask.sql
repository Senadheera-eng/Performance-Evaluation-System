/*
  The project report promises a system that warns rather than waits to be
  asked (§4.3): attendance alerts, medical deadline reminders, performance
  decline alerts, enrolment deadlines. Only the first existed, computed in
  the browser on the Dashboard and nowhere else — so the assistant could not
  see it, and the other three did not exist at all.

  get_my_insights() puts all of them in one place. One function, one set of
  rules, readable by the Dashboard and by the AI assistant, so the two can
  never tell a student different things about the same term.

  Every threshold comes from system_settings rather than being written into
  the logic, matching how the rest of the faculty's rules are handled. The
  GPA drop that counts as a decline is a new setting; the rest already
  existed.

  Nothing here is invented from thin data. Attendance insights only appear
  for a course that actually has recorded lectures — the same condition the
  Dashboard already applied, because otherwise every freshly enrolled course
  reads as nought per cent and the warning is noise.
*/

insert into public.system_settings (key, value, description)
values (
  'gpa_decline_alert_drop',
  '0.30'::jsonb,
  'A fall of at least this much in SGPA between two consecutive completed semesters is reported to the student as a decline.'
)
on conflict (key) do nothing;

create or replace function public.get_my_insights()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_student      uuid := auth.uid();
  v_department   text;
  v_batch        int;
  v_threshold    numeric;
  v_prewarn      numeric;
  v_decline_drop numeric;
  v_out          jsonb := '[]'::jsonb;
  r              record;
  v_prev_sgpa    numeric;
  v_prev_sem     int;
  v_last_sgpa    numeric;
  v_last_sem     int;
begin
  select department, batch_year into v_department, v_batch
    from students where id = v_student;
  if v_department is null then
    return jsonb_build_object('insights', '[]'::jsonb,
                              'note', 'Insights are only produced for students.');
  end if;

  select coalesce((value #>> '{}')::numeric, 80)   into v_threshold
    from system_settings where key = 'attendance_threshold';
  select coalesce((value #>> '{}')::numeric, 85)   into v_prewarn
    from system_settings where key = 'attendance_prewarning_threshold';
  select coalesce((value #>> '{}')::numeric, 0.30) into v_decline_drop
    from system_settings where key = 'gpa_decline_alert_drop';

  ----------------------------------------------------------------- attendance
  for r in
    select c.course_code, c.title,
           count(*) as lectures,
           round(((count(*) filter (where a.status in ('present','excused')))::numeric
                   / nullif(count(*), 0)) * 100, 1) as pct
      from attendance a
      join courses c on c.id = a.course_id
     where a.student_id = v_student
     group by c.course_code, c.title
    having count(*) > 0
  loop
    if r.pct < v_threshold then
      v_out := v_out || jsonb_build_object(
        'kind', 'attendance_risk', 'severity', 'critical',
        'title', format('Attendance below the minimum in %s', r.course_code),
        'detail', format(
          'You are at %s%% in %s (%s), against a required %s%%. Excused absences already count in your favour here.',
          r.pct, r.course_code, r.title, v_threshold),
        'course_code', r.course_code, 'value', r.pct, 'threshold', v_threshold);
    elsif r.pct < v_prewarn then
      v_out := v_out || jsonb_build_object(
        'kind', 'attendance_risk', 'severity', 'warning',
        'title', format('Attendance getting close to the limit in %s', r.course_code),
        'detail', format(
          'You are at %s%% in %s (%s). The minimum is %s%%, so there is not much room left.',
          r.pct, r.course_code, r.title, v_threshold),
        'course_code', r.course_code, 'value', r.pct, 'threshold', v_threshold);
    end if;
  end loop;

  ------------------------------------------------------------------ GPA trend
  /* The last two semesters that actually have a published SGPA, which is not
     always the last two semesters: a semester with nothing published yet
     would otherwise read as a collapse to zero. */
  for r in
    select (s->>'semester')::int as semester, (s->>'sgpa')::numeric as sgpa
      from jsonb_array_elements(get_my_academic_record() -> 'semesters') s
     where (s->>'sgpa') is not null
     order by (s->>'semester')::int desc
     limit 2
  loop
    if v_last_sgpa is null then
      v_last_sgpa := r.sgpa; v_last_sem := r.semester;
    else
      v_prev_sgpa := r.sgpa; v_prev_sem := r.semester;
    end if;
  end loop;

  if v_last_sgpa is not null and v_prev_sgpa is not null then
    if v_prev_sgpa - v_last_sgpa >= v_decline_drop then
      v_out := v_out || jsonb_build_object(
        'kind', 'gpa_decline', 'severity', 'warning',
        'title', 'Your semester GPA has dropped',
        'detail', format(
          'Semester %s came out at %s, down from %s in semester %s. That is a fall of %s. It is worth looking at which modules moved before the next set of marks.',
          v_last_sem, v_last_sgpa, v_prev_sgpa, v_prev_sem,
          round(v_prev_sgpa - v_last_sgpa, 2)),
        'value', v_last_sgpa, 'previous', v_prev_sgpa);
    elsif v_last_sgpa - v_prev_sgpa >= v_decline_drop then
      v_out := v_out || jsonb_build_object(
        'kind', 'gpa_improvement', 'severity', 'positive',
        'title', 'Your semester GPA has gone up',
        'detail', format(
          'Semester %s came out at %s, up from %s in semester %s. Whatever changed, it worked.',
          v_last_sem, v_last_sgpa, v_prev_sgpa, v_prev_sem),
        'value', v_last_sgpa, 'previous', v_prev_sgpa);
    end if;
  end if;

  --------------------------------------------------------------- medical dates
  for r in
    select ms.id, ms.deadline, ms.status, ms.missed_date,
           (ms.deadline - current_date) as days_left
      from medical_submissions ms
     where ms.student_id = v_student
       and ms.status = 'pending'
  loop
    if r.days_left < 0 then
      v_out := v_out || jsonb_build_object(
        'kind', 'medical_deadline', 'severity', 'critical',
        'title', 'A medical submission is past its deadline',
        'detail', format(
          'Your submission for %s was due on %s and is still pending review. Speak to your department office.',
          r.missed_date, r.deadline),
        'value', r.days_left);
    elsif r.days_left <= 3 then
      v_out := v_out || jsonb_build_object(
        'kind', 'medical_deadline', 'severity', 'warning',
        'title', 'A medical submission is close to its deadline',
        'detail', format(
          'Your submission for %s is due on %s — %s day(s) left, and it is still pending.',
          r.missed_date, r.deadline, r.days_left),
        'value', r.days_left);
    end if;
  end loop;

  ----------------------------------------------------------------- enrolment
  for r in
    select ep.title, ep.closes_at, (ep.closes_at::date - current_date) as days_left
      from enrollment_periods ep
     where ep.status = 'open'
       and now() between ep.opens_at and ep.closes_at
       and (ep.department is null or ep.department = v_department)
       and (ep.batch_year is null or ep.batch_year = v_batch)
     order by ep.closes_at
  loop
    v_out := v_out || jsonb_build_object(
      'kind', 'enrolment_open',
      'severity', case when r.days_left <= 3 then 'warning' else 'info' end,
      'title', format('Enrolment is open: %s', r.title),
      'detail', format('It closes on %s, %s day(s) from now.',
                       r.closes_at::date, r.days_left),
      'value', r.days_left);
  end loop;

  -------------------------------------------------------- outstanding modules
  if (select count(*) from my_outstanding_modules()) > 0 then
    v_out := v_out || jsonb_build_object(
      'kind', 'outstanding_modules', 'severity', 'warning',
      'title', 'You still have modules to clear',
      'detail', format(
        'There are %s module(s) carrying an R, F or L that you have to take again. The Enrollment page shows whether any of them are open to enrol in now.',
        (select count(*) from my_outstanding_modules())),
      'value', (select count(*) from my_outstanding_modules()));
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'thresholds', jsonb_build_object(
      'attendance_minimum', v_threshold,
      'attendance_prewarning', v_prewarn,
      'gpa_decline_drop', v_decline_drop),
    'insights', v_out
  );
end;
$$;

revoke execute on function public.get_my_insights() from public, anon;
grant execute on function public.get_my_insights() to authenticated, service_role;
