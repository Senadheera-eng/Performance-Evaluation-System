-- A repeated course is one course, sat twice.
--
-- Every attempt is published, so counting rows counted the course twice: the
-- credits an SGPA divides by included the superseded attempt, which carries
-- no grade point, so a repeat quietly dragged the average of the semester it
-- belonged to. The same count decided whether a semester was complete, and
-- two attempts at one course could make a semester of two courses look
-- finished with one still outstanding.
--
-- Attempts are ranked once, and everything reads that ranking: the averages
-- take the attempt that stands, and the course list carries both so the
-- student can see the repeat rather than wondering where a grade went.
create or replace function public.get_my_academic_record()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student   record;
  v_total_sem int;
  v_record    jsonb;
begin
  select st.id, st.batch_year, st.department into v_student
    from public.students st where st.id = auth.uid();
  if v_student.id is null then
    raise exception 'Only a student has an academic record here';
  end if;

  select coalesce((value #>> '{}')::int, 8) into v_total_sem
    from public.system_settings where key = 'total_semesters';
  v_total_sem := coalesce(v_total_sem, 8);

  with attempt as (
    select r.course_id, r.academic_year, r.grade, r.gpv, r.published_at,
           c.semester, c.course_code, c.title, c.credits, c.contributes_to_gpa,
           row_number() over w_asc  as attempt_number,
           count(*) over (partition by r.course_id) > 1 as has_repeat,
           row_number() over w_desc = 1 as is_latest_attempt
      from public.results r
      join public.courses c on c.id = r.course_id
     where r.student_id = v_student.id
       and r.is_published
    window
      w_asc  as (partition by r.course_id
                 order by r.academic_year, r.published_at nulls first),
      w_desc as (partition by r.course_id
                 order by r.academic_year desc, r.published_at desc nulls last)
  ),
  per_semester as (
    select s.semester,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'course_id',    a.course_id,
                     'course_code',  a.course_code,
                     'title',        a.title,
                     'credits',      a.credits,
                     'grade',        a.grade,
                     'gpv',          a.gpv,
                     'contributes_to_gpa', a.contributes_to_gpa,
                     'published_at', a.published_at,
                     'academic_year', a.academic_year,
                     'attempt_number', a.attempt_number,
                     'has_repeat',   a.has_repeat,
                     'is_latest_attempt', a.is_latest_attempt)
                     order by a.course_code, a.attempt_number), '[]'::jsonb)
              from attempt a where a.semester = s.semester) as courses,
           -- One course, however many times it was sat.
           (select count(distinct a.course_id)::int
              from attempt a
             where a.semester = s.semester and a.is_latest_attempt) as published,
           -- What the student is on the hook for. Zero means the semester
           -- predates the enrolment system, not that they took nothing.
           (select count(distinct e.course_id)::int
              from public.enrollments e
              join public.courses c on c.id = e.course_id
             where e.student_id = v_student.id
               and e.status = 'enrolled'
               and c.semester = s.semester) as enrolled,
           -- Only the attempt that stands, so its credits count once.
           (select sum(a.gpv * a.credits)
              from attempt a
             where a.semester = s.semester
               and a.contributes_to_gpa and a.gpv is not null) as points,
           (select sum(a.credits)::int
              from attempt a
             where a.semester = s.semester
               and a.contributes_to_gpa and a.gpv is not null) as gpa_credits,
           -- When the semester was sat, which a later repeat does not move.
           (select min(a.academic_year)
              from attempt a where a.semester = s.semester) as academic_year
      from generate_series(1, v_total_sem) as s(semester)
  ),
  judged as (
    select p.*,
           (p.enrolled = 0 and p.published > 0)
        or (p.enrolled > 0 and p.published >= p.enrolled) as complete
      from per_semester p
  ),
  counted as (
    select j.*,
           /* An SGPA computed from a third of the marks is not a fact, so it
              waits for the rest of the semester. */
           case when j.complete and coalesce(j.gpa_credits, 0) > 0
                then round(j.points / j.gpa_credits, 2) end as sgpa
      from judged j
  )
  select jsonb_build_object(
           'cgpa', case when sum(gpa_credits) filter (where sgpa is not null) > 0
                        then round(sum(points) filter (where sgpa is not null)
                                   / sum(gpa_credits) filter (where sgpa is not null), 2)
                   end,
           'gpa_credits', coalesce(sum(gpa_credits) filter (where sgpa is not null), 0),
           'semesters', jsonb_agg(jsonb_build_object(
             'semester',      semester,
             'academic_year', coalesce(academic_year,
               (v_student.batch_year + ceil(semester / 2.0)::int - 1)::text || '/' ||
               (v_student.batch_year + ceil(semester / 2.0)::int)::text),
             'enrolled',      enrolled,
             'published',     published,
             'complete',      complete,
             'gpa_credits',   coalesce(gpa_credits, 0),
             'sgpa',          sgpa,
             'courses',       courses) order by semester))
    into v_record
    from counted;

  return v_record;
end;
$$;;
