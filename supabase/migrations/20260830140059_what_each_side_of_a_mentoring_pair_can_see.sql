-- what_each_side_of_a_mentoring_pair_can_see
-- Applied 20260830140059
-- Exported from the live project; do not edit by hand.

-- What each side of a mentoring pair can see.
--
-- Three views of one allocation. The student sees the person they were given
-- and how to reach them. The mentor sees their own students, with the figures
-- that say which of them to talk to first. The head of department sees the
-- whole allocation, which lecturer is carrying how many, and who has nobody.
--
-- None of the thresholds are written down here. Whether a CGPA is failing,
-- what attendance the Handbook requires -- the faculty already states both in
-- system_settings, and a rule copied into a function is a rule that goes
-- quietly wrong the day the faculty changes it.

/* ------------------------------------------------------------------ */
/* Student: who is my mentor                                           */
/* ------------------------------------------------------------------ */

create or replace function public.get_my_mentor()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
           'assignment_id', ma.id,
           'assigned_at',   ma.assigned_at,
           'mentor_id',     l.id,
           'name',          coalesce(l.title || ' ', '') || l.name,
           'plain_name',    l.name,
           'title',         l.title,
           'email',         l.email,
           'department',    l.department,
           'staff_no',      l.staff_no,
           'is_hod',        exists (select 1 from public.hod_appointments h
                                     where h.lecturer_id = l.id and h.ended_at is null))
    into v_result
    from public.mentor_assignments ma
    join public.lecturers l on l.id = ma.mentor_id
   where ma.student_id = auth.uid() and ma.ended_at is null;

  return v_result;  -- null when nobody has been assigned yet
end;
$$;

grant execute on function public.get_my_mentor() to authenticated;

/* ------------------------------------------------------------------ */
/* Mentor: my students, and which of them to look at first             */
/* ------------------------------------------------------------------ */

create or replace function public.get_my_mentees()
returns table(
  student_id uuid, name text, index_number text, reg_number text, email text,
  department text, batch_year integer, assigned_at timestamptz,
  latest_semester integer, cgpa numeric, credits_earned integer,
  latest_sgpa numeric, latest_sgpa_semester integer,
  modules_passed integer, modules_failed integer,
  modules_repeat integer, modules_medical integer,
  attendance_pct numeric, risk_band text)
language plpgsql stable security definer set search_path to 'public'
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
  graded as (
    select r.student_id,
           sum(c.credits * r.gpv) filter (where c.contributes_to_gpa and r.gpv is not null) as weighted,
           sum(c.credits)         filter (where c.contributes_to_gpa and r.gpv is not null) as credits,
           max(c.semester)                                                                  as top_semester,
           count(*) filter (where r.grade not in ('R','L','F'))                             as passed,
           count(*) filter (where r.grade = 'F')                                            as failed,
           count(*) filter (where r.grade = 'R')                                            as repeats,
           count(*) filter (where r.grade = 'L')                                            as medicals
      from public.results r
      join public.courses c on c.id = r.course_id
      join mine m           on m.student_id = r.student_id
     where r.is_published
     group by r.student_id
  ),
  -- The most recent semester that actually carries a GPA, which is not
  -- always the highest semester on record.
  sgpa as (
    select distinct on (r.student_id)
           r.student_id, c.semester,
           round((sum(c.credits * r.gpv) over w
                  / nullif(sum(c.credits) over w, 0))::numeric, 2) as value
      from public.results r
      join public.courses c on c.id = r.course_id
      join mine m           on m.student_id = r.student_id
     where r.is_published and c.contributes_to_gpa and r.gpv is not null
    window w as (partition by r.student_id, c.semester)
     order by r.student_id, c.semester desc
  ),
  att as (
    select a.student_id,
           count(*) filter (where a.status in ('present','excused'))::numeric as here,
           count(*)::numeric                                                  as total
      from public.attendance a
      join mine m on m.student_id = a.student_id
     group by a.student_id
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
$$;

grant execute on function public.get_my_mentees() to authenticated;

/* ------------------------------------------------------------------ */
/* Mentor: one student, whole degree                                   */
/* ------------------------------------------------------------------ */

create or replace function public.get_mentee_academic_overview(p_student_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
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

  select sum(c.credits * r.gpv) filter (where c.contributes_to_gpa and r.gpv is not null) as weighted,
         sum(c.credits)         filter (where c.contributes_to_gpa and r.gpv is not null) as credits,
         count(*) filter (where r.grade not in ('R','L','F')) as passed,
         count(*) filter (where r.grade = 'F')                as failed,
         count(*) filter (where r.grade = 'R')                as repeats,
         count(*) filter (where r.grade = 'L')                as medicals
    into v_totals
    from public.results r
    join public.courses c on c.id = r.course_id
   where r.student_id = p_student_id and r.is_published;

  select count(*) filter (where a.status in ('present','excused'))::numeric as here,
         count(*)::numeric as total
    into v_att
    from public.attendance a where a.student_id = p_student_id;

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
               'credits', coalesce(sum(c.credits) filter (where r.grade not in ('R','L','F')), 0),
               'courses', jsonb_agg(jsonb_build_object(
                            'course_code', c.course_code,
                            'title', c.title,
                            'credits', c.credits,
                            'contributes_to_gpa', c.contributes_to_gpa,
                            'grade', r.grade,
                            'gpv', r.gpv)
                          order by c.course_code)) as x
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
$$;

grant execute on function public.get_mentee_academic_overview(uuid) to authenticated;

/* ------------------------------------------------------------------ */
/* Head of department: the whole allocation                            */
/* ------------------------------------------------------------------ */

-- Every student in the department with their current mentor, or none. This
-- is the assignment screen: the unassigned are the work.
create or replace function public.get_department_mentor_roster()
returns table(
  student_id uuid, name text, index_number text, reg_number text, email text,
  department text, batch_year integer, cgpa numeric,
  mentor_id uuid, mentor_name text, assigned_at timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_is_super boolean := coalesce(public.get_my_role(), '') = 'super_admin';
  v_dept     text    := public.my_hod_department();
begin
  if not v_is_super and v_dept is null then
    raise exception 'Mentor allocation is the head of department''s to see';
  end if;

  return query
  with graded as (
    select r.student_id,
           sum(c.credits * r.gpv) filter (where c.contributes_to_gpa and r.gpv is not null) as weighted,
           sum(c.credits)         filter (where c.contributes_to_gpa and r.gpv is not null) as credits
      from public.results r
      join public.courses c on c.id = r.course_id
     where r.is_published
     group by r.student_id
  )
  select s.id, s.name, s.index_number, s.reg_number, s.email,
         s.department, s.batch_year,
         case when g.credits > 0 then round((g.weighted / g.credits)::numeric, 2) end,
         l.id, coalesce(l.title || ' ', '') || l.name, ma.assigned_at
    from public.students s
    left join graded g on g.student_id = s.id
    left join public.mentor_assignments ma
      on ma.student_id = s.id and ma.ended_at is null
    left join public.lecturers l on l.id = ma.mentor_id
   where s.role = 'student' and s.status = 'active'
     and (v_is_super or s.department = v_dept)
   order by s.batch_year desc, s.index_number;
end;
$$;

grant execute on function public.get_department_mentor_roster() to authenticated;

-- The allocation matrix: one row per lecturer, one count per batch. A
-- lecturer with nobody still appears, because an empty column is what tells
-- the head who is free to take someone.
create or replace function public.get_department_mentor_allocations()
returns table(
  mentor_id uuid, mentor_name text, email text, is_hod boolean,
  total integer, by_batch jsonb)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_is_super boolean := coalesce(public.get_my_role(), '') = 'super_admin';
  v_dept     text    := public.my_hod_department();
begin
  if not v_is_super and v_dept is null then
    raise exception 'Mentor allocation is the head of department''s to see';
  end if;

  return query
  select l.id,
         coalesce(l.title || ' ', '') || l.name,
         l.email,
         exists (select 1 from public.hod_appointments h
                  where h.lecturer_id = l.id and h.ended_at is null),
         count(ma.student_id)::int,
         coalesce(
           (select jsonb_object_agg(b.batch_year::text, b.n)
              from (select s2.batch_year, count(*)::int as n
                      from public.mentor_assignments ma2
                      join public.students s2 on s2.id = ma2.student_id
                     where ma2.mentor_id = l.id and ma2.ended_at is null
                       and s2.status = 'active'
                     group by s2.batch_year) b),
           '{}'::jsonb)
    from public.lecturers l
    left join public.mentor_assignments ma
      on ma.mentor_id = l.id and ma.ended_at is null
   where l.status = 'active'
     and (v_is_super or l.department = v_dept)
   group by l.id, l.title, l.name, l.email
   order by l.name;
end;
$$;

grant execute on function public.get_department_mentor_allocations() to authenticated;

-- Who has mentored this student, and who does now.
create or replace function public.get_student_mentor_history(p_student_id uuid)
returns table(
  assignment_id uuid, mentor_id uuid, mentor_name text,
  assigned_at timestamptz, ended_at timestamptz, end_reason text,
  assigned_by_name text, notes text, is_current boolean)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public.can_view_student_record(p_student_id)
     and p_student_id is distinct from auth.uid() then
    raise exception 'Not authorised to view this student''s mentoring history';
  end if;

  return query
  select ma.id, ma.mentor_id,
         coalesce(l.title || ' ', '') || l.name,
         ma.assigned_at, ma.ended_at, ma.end_reason,
         coalesce(
           (select coalesce(al.title || ' ', '') || al.name
              from public.lecturers al where al.auth_user_id = ma.assigned_by),
           (select ad.name from public.admins ad where ad.id = ma.assigned_by)),
         ma.notes,
         ma.ended_at is null
    from public.mentor_assignments ma
    join public.lecturers l on l.id = ma.mentor_id
   where ma.student_id = p_student_id
   order by ma.assigned_at desc;
end;
$$;

grant execute on function public.get_student_mentor_history(uuid) to authenticated;
