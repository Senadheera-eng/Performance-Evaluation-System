-- What a student still has to do to graduate, for the Graduation Planner.
--
-- get_my_graduation_plan also returns:
--   outstanding:  courses whose latest attempt is F, R or L and which are not
--                 being sat now. Each must be passed to graduate; a repeat or
--                 re-sit can earn at most a C (Handbook p. 20).
--   requirements: credits passed towards the 144 the degree needs (every
--                 passed course, counted or not in the GPA), whether
--                 Industrial Training is recorded (a separate 6-credit
--                 requirement), and the chosen minor's progress.
--
-- And the minor plan follows a course graded over two semesters: the
-- Semester 6 part of a minor project never has a result of its own, so it
-- takes the result of the part it is graded with, and counts as in progress
-- while the student is enrolled in that part. Before, its basket could never
-- be met, and no student could complete the Data Management or High
-- Performance Computing minor.
do $$
declare
  v_def text;
  v_old text;
begin
  select pg_get_functiondef('public.student_minor_plan'::regproc) into v_def;

  v_old := 'where r.student_id = st.id and r.course_id = mc.course_id and r.is_published';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'student_minor_plan: result lookup not found exactly once';
  end if;
  v_def := replace(v_def, v_old,
    'where r.student_id = st.id and r.course_id = coalesce(c.graded_with, mc.course_id) and r.is_published');

  v_old := 'end) as enrolled';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'student_minor_plan: enrolled flag not found exactly once';
  end if;
  v_def := replace(v_def, v_old,
    'end)' || chr(10) ||
    '           or (c.graded_with is not null and exists (' || chr(10) ||
    '                 select 1 from public.enrollments e2' || chr(10) ||
    '                  where e2.student_id = st.id and e2.course_id = c.graded_with' || chr(10) ||
    '                    and e2.status = ''enrolled'')) as enrolled');

  execute v_def;
end $$;

create or replace function public.get_my_graduation_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student      record;
  v_total_sem    int;
  v_total_cr     int;
  v_done         record;
  v_courses      jsonb;
  v_last         int;
  v_semesters    jsonb := '[]'::jsonb;
  v_cr           int;
  v_known        int := 0;
  v_unknown      int := 0;
  v_sem          int;
  v_outstanding  jsonb;
  v_passed       int;
  v_training     boolean;
  v_minor        jsonb;
begin
  select s.id, s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student.id is null then
    raise exception 'Only a student has a graduation plan';
  end if;

  select coalesce((value #>> '{}')::int, 8) into v_total_sem
    from public.system_settings where key = 'total_semesters';
  v_total_sem := coalesce(v_total_sem, 8);
  select coalesce((value #>> '{}')::int, 144) into v_total_cr
    from public.system_settings where key = 'graduation_total_credits';
  v_total_cr := coalesce(v_total_cr, 144);

  select coalesce(sum(c.result_credits), 0)::int                       as credits,
         coalesce(sum(c.result_credits * r.gpv), 0)::numeric           as points,
         coalesce(max(c.semester), 0)::int                             as last_semester
    into v_done
    from public.results r
    join public.courses c on c.id = r.course_id
   where r.student_id = v_student.id
     and r.is_published
     and r.gpv is not null
     and c.contributes_to_gpa;

  with sitting as (
    select distinct on (c.id)
           c.id, c.course_code, c.title, c.semester, c.credits, c.result_credits,
           c.contributes_to_gpa, c.graded_with, e.academic_year, e.enrollment_kind
      from public.enrollments e
      join public.courses c on c.id = e.course_id
     where e.student_id = v_student.id
       and e.status = 'enrolled'
       and not exists (select 1 from public.results r
                        where r.student_id = e.student_id
                          and r.course_id = c.id
                          and r.is_published
                          and r.academic_year = e.academic_year)
     order by c.id, e.academic_year desc
  ),
  described as (
    select s.*,
           -- An earlier attempt that still stands on the record: this is a
           -- repeat, and its grade will replace that one.
           (select jsonb_build_object('grade', r.grade, 'gpv', r.gpv,
                                      'original_grade', r.original_grade,
                                      'academic_year', r.academic_year)
              from public.results r
             where r.student_id = v_student.id and r.course_id = s.id
               and r.is_published and r.gpv is not null
             order by r.academic_year desc, r.published_at desc nulls last
             limit 1) as previous,
           (select jsonb_build_object('course_code', f.course_code, 'semester', f.semester,
                                      'credits', f.result_credits)
              from public.courses f where f.id = s.graded_with) as graded_in,
           (select jsonb_agg(jsonb_build_object('semester', p.semester, 'credits', p.credits)
                             order by p.semester)
              from public.courses p where p.graded_with = s.id) as earlier_parts
      from sitting s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'course_id',          d.id,
           'course_code',        d.course_code,
           'title',              d.title,
           'semester',           d.semester,
           'academic_year',      d.academic_year,
           'enrollment_kind',    d.enrollment_kind,
           'credits',            d.credits,
           'result_credits',     d.result_credits,
           'contributes_to_gpa', d.contributes_to_gpa,
           'previous',           d.previous,
           'graded_in',          d.graded_in,
           'earlier_parts',      d.earlier_parts)
           order by d.semester, d.course_code), '[]'::jsonb)
    into v_courses
    from described d;

  -- The semester in progress, from what the student is sitting. A repeat adds
  -- no new credits: the earlier attempt's are already counted.
  for v_sem, v_cr in
    select (x->>'semester')::int,
           sum(case when x->'previous' is null or x->'previous' = 'null'::jsonb
                    then (x->>'result_credits')::int else 0 end)::int
      from jsonb_array_elements(v_courses) x
     where (x->>'contributes_to_gpa')::boolean
     group by 1
     order by 1
  loop
    if v_cr > 0 then
      v_semesters := v_semesters || jsonb_build_object(
        'semester', v_sem, 'credits', v_cr, 'source', 'enrolled');
      v_known := v_known + v_cr;
    end if;
  end loop;

  -- Then every semester after it, from the curriculum.
  v_last := greatest(v_done.last_semester,
                     coalesce((select max((x->>'semester')::int)
                                 from jsonb_array_elements(v_courses) x), 0));
  for v_sem in (v_last + 1)..v_total_sem loop
    v_cr := public.curriculum_gpa_credits(v_student.department, v_sem);
    if v_cr is null then
      v_unknown := v_unknown + 1;
    else
      v_known := v_known + v_cr;
    end if;
    v_semesters := v_semesters || jsonb_build_object(
      'semester', v_sem, 'credits', v_cr,
      'source', case when v_cr is null then 'estimate' else 'curriculum' end);
  end loop;

  -- A semester the curriculum cannot speak for yet shares out what the degree
  -- total leaves, as the planner always assumed.
  if v_unknown > 0 then
    v_cr := round(greatest(0, v_total_cr - v_done.credits - v_known)::numeric / v_unknown);
    select jsonb_agg(case when x->'credits' = 'null'::jsonb
                          then jsonb_set(x, '{credits}', to_jsonb(v_cr)) else x end)
      into v_semesters
      from jsonb_array_elements(v_semesters) x;
  end if;

  -- Modules to clear: a course whose latest attempt is a fail (F), a
  -- referral (R) or a deferral (L), and which is not being sat now. It must
  -- be passed to graduate, and a repeat or re-sit is capped (Handbook p. 20).
  with latest as (
    select distinct on (r.course_id)
           r.course_id, r.grade, r.gpv, r.original_grade, r.academic_year
      from public.results r
     where r.student_id = v_student.id and r.is_published
     order by r.course_id, r.academic_year desc, r.published_at desc nulls last
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'course_id',          c.id,
           'course_code',        c.course_code,
           'title',              c.title,
           'semester',           c.semester,
           'credits',            c.credits,
           'result_credits',     c.result_credits,
           'contributes_to_gpa', c.contributes_to_gpa,
           'grade',              l.grade,
           'gpv',                l.gpv,
           'original_grade',     l.original_grade,
           'academic_year',      l.academic_year)
           order by c.semester, c.course_code), '[]'::jsonb)
    into v_outstanding
    from latest l
    join public.courses c on c.id = l.course_id
   where l.grade in ('F', 'R', 'L')
     and not exists (select 1 from jsonb_array_elements(v_courses) x
                      where (x->>'course_id')::uuid = c.id);

  -- Credits passed towards the degree's 144: every course passed, whether or
  -- not it counts towards the GPA, by the credits its result carries.
  -- Industrial Training is a requirement of its own (6 credits), not part of
  -- the 144 (Handbook p. 25).
  with latest as (
    select distinct on (r.course_id) r.course_id, r.grade
      from public.results r
     where r.student_id = v_student.id and r.is_published
     order by r.course_id, r.academic_year desc, r.published_at desc nulls last
  )
  select coalesce(sum(c.result_credits) filter (where c.title not ilike '%industrial training%'), 0)::int,
         coalesce(bool_or(c.title ilike '%industrial training%'), false)
    into v_passed, v_training
    from latest l
    join public.courses c on c.id = l.course_id
   where l.grade is not null and l.grade not in ('F', 'R', 'L');

  -- The minor the student has said they are taking, if any.
  select jsonb_build_object(
           'minor',    m->>'minor',
           'earned',   (m->>'earned_credits')::int,
           'planned',  (m->>'planned_credits')::int,
           'required', (m->>'required_credits')::int,
           'complete', (m->>'complete')::boolean)
    into v_minor
    from jsonb_array_elements(public.get_my_minor_progress()->'minors') m
   where m->>'minor' = public.get_my_minor_progress()->>'chosen_minor';

  return jsonb_build_object(
    'total_semesters',  v_total_sem,
    'department',       v_student.department,
    'resit_max_grade',  coalesce((select value #>> '{}' from public.system_settings
                                   where key = 'resit_max_grade'), 'C'),
    'completed', jsonb_build_object(
      'credits',       v_done.credits,
      'points',        v_done.points,
      'last_semester', v_done.last_semester,
      'cgpa',          case when v_done.credits > 0
                            then round(v_done.points / v_done.credits, 2) end),
    'semesters', coalesce(v_semesters, '[]'::jsonb),
    'courses',   v_courses,
    'outstanding', v_outstanding,
    'requirements', jsonb_build_object(
      'credits_passed',   v_passed,
      'credits_required', v_total_cr,
      'training_done',    v_training,
      'minor',            v_minor));
end;
$$;

revoke all on function public.get_my_graduation_plan() from public, anon;
grant execute on function public.get_my_graduation_plan() to authenticated;
