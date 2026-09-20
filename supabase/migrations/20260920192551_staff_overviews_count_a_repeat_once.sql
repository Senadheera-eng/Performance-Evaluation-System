-- What a mentor and an admin are shown about a student follows the same rule
-- the student's own record does: a course sat twice is one course.
--
-- Counting published rows made a repeated course both a failure and a pass at
-- the same time, so "modules passed" and the credits behind a semester were
-- both too high, and the attendance percentage averaged a term already served
-- with the one being sat now.

create or replace function public.get_mentee_academic_overview(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student  record;
  v_sems     jsonb;
  v_totals   record;
  v_att      record;
  v_mentor   jsonb;
begin
  -- The same gate the transcript uses, so a mentor reaching a student who is
  -- no longer theirs is refused here and not merely shown less.
  if not public.can_view_student_record(p_student_id) then
    raise exception 'Not authorised to view this student''s record';
  end if;

  select s.id, s.name, s.index_number, s.reg_number, s.email,
         s.department, s.batch_year
    into v_student
    from public.students s where s.id = p_student_id;
  if v_student.id is null then
    raise exception 'No such student';
  end if;

  -- Where a course was sat more than once, the attempt that stands is the one
  -- the module counts are about: a module passed on the second attempt is
  -- passed, not both passed and failed.
  create temp view mentee_attempt as select 1;  -- placeholder, replaced below
  drop view mentee_attempt;

  with attempt as (
    select r.grade, r.gpv, r.academic_year,
           c.semester, c.course_code, c.title, c.credits, c.contributes_to_gpa,
           row_number() over (partition by r.course_id
                              order by r.academic_year desc,
                                       r.published_at desc nulls last) = 1
             as is_latest_attempt
      from public.results r
      join public.courses c on c.id = r.course_id
     where r.student_id = p_student_id and r.is_published
  )
  select sum(a.credits * a.gpv) filter (where a.contributes_to_gpa and a.gpv is not null) as weighted,
         sum(a.credits)         filter (where a.contributes_to_gpa and a.gpv is not null) as credits,
         count(*) filter (where a.is_latest_attempt and a.grade not in ('R','L','F')) as passed,
         count(*) filter (where a.is_latest_attempt and a.grade = 'F')                as failed,
         count(*) filter (where a.is_latest_attempt and a.grade = 'R')                as repeats,
         count(*) filter (where a.is_latest_attempt and a.grade = 'L')                as medicals
    into v_totals
    from attempt a;

  -- Attendance on the delivery each course is being sat in now.
  with delivery as (
    select a.course_id, o.academic_year, a.status,
           dense_rank() over (partition by a.course_id
                              order by o.academic_year desc) = 1 as is_latest
      from public.attendance a
      join public.course_offerings o on o.id = a.offering_id
     where a.student_id = p_student_id
  )
  select count(*) filter (where status in ('present','excused'))::numeric as here,
         count(*)::numeric as total
    into v_att
    from delivery where is_latest;

  -- One entry per semester that has published results, with its own SGPA and
  -- the courses behind it.
  select jsonb_agg(x order by x->>'semester')
    into v_sems
    from (
      select jsonb_build_object(
               'semester', c.semester,
               'academic_year', min(r.academic_year),
               'sgpa', case when sum(c.credits) filter (where c.contributes_to_gpa and r.gpv is not null) > 0
                            then round((sum(c.credits * r.gpv) filter (where c.contributes_to_gpa and r.gpv is not null)
                                      / sum(c.credits) filter (where c.contributes_to_gpa and r.gpv is not null))::numeric, 2)
                       end,
               'credits', coalesce(sum(c.credits) filter (
                            where r.gpv is not null and r.grade not in ('R','L','F')), 0),
               'courses', jsonb_agg(jsonb_build_object(
                            'course_code', c.course_code,
                            'title', c.title,
                            'credits', c.credits,
                            'contributes_to_gpa', c.contributes_to_gpa,
                            'grade', r.grade,
                            'gpv', r.gpv)
                          order by c.course_code, r.academic_year)) as x
        from public.results r
        join public.courses c on c.id = r.course_id
       where r.student_id = p_student_id and r.is_published
       group by c.semester
    ) t;

  select jsonb_build_object(
           'mentor_id', l.id,
           'name', coalesce(l.title || ' ', '') || l.name,
           'email', l.email,
           'assigned_at', ma.assigned_at)
    into v_mentor
    from public.mentor_assignments ma
    join public.lecturers l on l.id = ma.mentor_id
   where ma.student_id = p_student_id and ma.ended_at is null;

  return jsonb_build_object(
    'student', jsonb_build_object(
      'student_id', v_student.id, 'name', v_student.name,
      'index_number', v_student.index_number, 'reg_number', v_student.reg_number,
      'email', v_student.email, 'department', v_student.department,
      'batch_year', v_student.batch_year),
    'mentor', v_mentor,
    'cgpa', case when v_totals.credits > 0
                 then round((v_totals.weighted / v_totals.credits)::numeric, 2) end,
    'credits_earned', coalesce(v_totals.credits, 0),
    'modules', jsonb_build_object(
      'passed', coalesce(v_totals.passed, 0),
      'failed', coalesce(v_totals.failed, 0),
      'repeat', coalesce(v_totals.repeats, 0),
      'medical', coalesce(v_totals.medicals, 0)),
    'attendance', jsonb_build_object(
      'present', coalesce(v_att.here, 0),
      'total', coalesce(v_att.total, 0),
      'pct', case when v_att.total > 0
                  then round(v_att.here / v_att.total * 100, 1) end),
    'semesters', coalesce(v_sems, '[]'::jsonb));
end;
$$;;
