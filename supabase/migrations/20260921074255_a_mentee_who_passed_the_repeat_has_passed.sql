-- The mentee list follows the same rule as the rest of the record: a course
-- sat twice is one course, and the attempt that stands is the later one.
--
-- Counting published rows meant passing a repeat made the student look worse:
-- the old F stayed in the failure count and the pass was never added, so the
-- risk band said "needs attention" for ever and the one thing the page exists
-- to show — who to talk to — could never come right. Attendance had the
-- matching fault, averaging a term already served into the term being sat.
--
-- The CGPA and the credits were already correct: they follow the grade point,
-- which a superseded attempt no longer carries.
create or replace function public.get_my_mentees()
returns table (
  student_id uuid, name text, index_number text, reg_number text, email text,
  department text, batch_year integer, assigned_at timestamp with time zone,
  latest_semester integer, cgpa numeric, credits_earned integer,
  latest_sgpa numeric, latest_sgpa_semester integer,
  modules_passed integer, modules_failed integer, modules_repeat integer,
  modules_medical integer, attendance_pct numeric, risk_band text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lecturer  uuid := public.my_lecturer_id();
  v_pass      numeric;
  v_min_att   numeric;
begin
  if v_lecturer is null then return; end if;

  -- The faculty's own numbers: the Pass classification's floor, and the
  -- attendance the Handbook requires for exam eligibility.
  select (e->>'threshold')::numeric into v_pass
    from public.system_settings s,
         lateral jsonb_array_elements(s.value) e
   where s.key = 'honours_classifications' and e->>'key' = 'pass';
  select (value #>> '{}')::numeric into v_min_att
    from public.system_settings where key = 'attendance_threshold';

  return query
  with mine as (
    select ma.student_id, ma.assigned_at
      from public.mentor_assignments ma
     where ma.mentor_id = v_lecturer and ma.ended_at is null
  ),
  attempt as (
    select r.student_id, r.grade, r.gpv, c.semester, c.credits, c.contributes_to_gpa,
           row_number() over (partition by r.student_id, r.course_id
                              order by r.academic_year desc,
                                       r.published_at desc nulls last) = 1
             as is_latest_attempt
      from public.results r
      join public.courses c on c.id = r.course_id
      join mine m           on m.student_id = r.student_id
     where r.is_published
  ),
  graded as (
    select a.student_id,
           sum(a.credits * a.gpv) filter (where a.contributes_to_gpa and a.gpv is not null) as weighted,
           sum(a.credits)         filter (where a.contributes_to_gpa and a.gpv is not null) as credits,
           max(a.semester)                                                                  as top_semester,
           -- One course, whichever attempt it was finally passed on.
           count(*) filter (where a.is_latest_attempt and a.grade not in ('R','L','F')) as passed,
           count(*) filter (where a.is_latest_attempt and a.grade = 'F')                as failed,
           count(*) filter (where a.is_latest_attempt and a.grade = 'R')                as repeats,
           count(*) filter (where a.is_latest_attempt and a.grade = 'L')                as medicals
      from attempt a
     group by a.student_id
  ),
  -- The most recent semester that actually carries a GPA, which is not
  -- always the highest semester on record.
  sgpa as (
    select distinct on (a.student_id)
           a.student_id, a.semester,
           round((sum(a.credits * a.gpv) over w
                  / nullif(sum(a.credits) over w, 0))::numeric, 2) as value
      from attempt a
     where a.contributes_to_gpa and a.gpv is not null
    window w as (partition by a.student_id, a.semester)
     order by a.student_id, a.semester desc
  ),
  -- Attendance on the delivery each course is being sat in now.
  delivery as (
    select a.student_id, a.status,
           dense_rank() over (partition by a.student_id, a.course_id
                              order by o.academic_year desc) = 1 as is_latest
      from public.attendance a
      join public.course_offerings o on o.id = a.offering_id
      join mine m on m.student_id = a.student_id
  ),
  att as (
    select d.student_id,
           count(*) filter (where d.status in ('present','excused'))::numeric as here,
           count(*)::numeric                                                  as total
      from delivery d
     where d.is_latest
     group by d.student_id
  )
  select s.id, s.name, s.index_number, s.reg_number, s.email,
         s.department, s.batch_year, m.assigned_at,
         coalesce(g.top_semester, 0)::int,
         case when g.credits > 0 then round((g.weighted / g.credits)::numeric, 2) end,
         coalesce(g.credits, 0)::int,
         sg.value, sg.semester,
         coalesce(g.passed, 0)::int, coalesce(g.failed, 0)::int,
         coalesce(g.repeats, 0)::int, coalesce(g.medicals, 0)::int,
         case when a.total > 0 then round(a.here / a.total * 100, 1) end,
         case
           -- Order matters: the worst true thing is the one to show.
           when g.credits > 0 and (g.weighted / g.credits) < v_pass then 'at_risk'
           when coalesce(g.repeats, 0) + coalesce(g.medicals, 0)
              + coalesce(g.failed, 0) > 0                            then 'needs_attention'
           when a.total > 0 and (a.here / a.total * 100) < v_min_att then 'attendance_concern'
           else 'good'
         end
    from mine m
    join public.students s on s.id = m.student_id
    left join graded g on g.student_id = s.id
    left join sgpa   sg on sg.student_id = s.id
    left join att    a  on a.student_id = s.id
   order by s.batch_year desc, s.index_number;
end;
$$;;
