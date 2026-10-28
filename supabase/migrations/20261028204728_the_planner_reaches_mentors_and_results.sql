-- The Graduation Planner reaches past the student: a gold-medal check, a
-- plan the student can share with their mentor, and a word when a
-- semester's results are complete.
--
-- graduation_plan_for(student) is the plan for any one student, so the
-- mentor's view and the results notice can use it; get_my_graduation_plan
-- is the student's own call to it. The plan also lists compulsory or
-- elective courses the student failed and repeated, which rule out the
-- faculty gold medal (Handbook p. 25).
create or replace function public.graduation_plan_for(p_student uuid)
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
  v_cur_sem      int;
  v_cur_year     text;
  v_minor_plan   jsonb;
  v_repeated     jsonb;
begin
  select s.id, s.batch_year, s.department into v_student
    from public.students s where s.id = p_student;
  if v_student.id is null then
    raise exception 'No such student';
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
  v_cur_sem := public.current_semester_for_batch(v_student.batch_year);
  v_cur_year := (v_student.batch_year + ceil(v_cur_sem / 2.0)::int - 1)::text || '/'
             || (v_student.batch_year + ceil(v_cur_sem / 2.0)::int)::text;
  v_minor_plan := public.student_minor_plan(p_student, v_cur_sem, v_cur_year);
  select jsonb_build_object(
           'minor',    m->>'minor',
           'earned',   (m->>'earned_credits')::int,
           'planned',  (m->>'planned_credits')::int,
           'required', (m->>'required_credits')::int,
           'complete', (m->>'complete')::boolean)
    into v_minor
    from jsonb_array_elements(v_minor_plan->'minors') m
   where m->>'minor' = v_minor_plan->>'chosen_minor';

  -- Compulsory or elective courses failed and repeated, which rule out the
  -- faculty gold medal (Handbook p. 25: "has not repeated in any of the
  -- Compulsory and Elective courses").
  select coalesce(jsonb_agg(distinct c.course_code), '[]'::jsonb)
    into v_repeated
    from public.results r
    join public.courses c on c.id = r.course_id
   where r.student_id = p_student and r.is_published
     and c.category in ('Compulsory', 'Elective')
     and (r.grade = 'F' or r.original_grade = 'F');

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
      'minor',            v_minor,
      'repeated',         v_repeated));
end;
$$;

-- Internal: the planner, the mentor's view and the results nudge call it,
-- each after its own check of who may see whose plan.
revoke all on function public.graduation_plan_for(uuid) from public, anon, authenticated;

create or replace function public.get_my_graduation_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.students s where s.id = auth.uid()) then
    raise exception 'Only a student has a graduation plan';
  end if;
  return public.graduation_plan_for(auth.uid());
end;
$$;

revoke all on function public.get_my_graduation_plan() from public, anon;
grant execute on function public.get_my_graduation_plan() to authenticated;

-- The class a student is aiming for: the one they last picked in Semester
-- targets. Their own; a mentor sees it only alongside a shared plan.
create table if not exists public.planner_aims (
  student_id  uuid primary key default auth.uid() references public.students (id) on delete cascade,
  class_key   text not null check (char_length(class_key) between 1 and 40),
  updated_at  timestamptz not null default now()
);
alter table public.planner_aims enable row level security;
revoke all on public.planner_aims from anon;
grant select, insert, update, delete on public.planner_aims to authenticated;
drop policy if exists planner_aims_own on public.planner_aims;
create policy planner_aims_own on public.planner_aims
  for all to authenticated
  using (student_id = auth.uid() and public.account_is_active(auth.uid()))
  with check (student_id = auth.uid() and public.account_is_active(auth.uid()));

-- One scenario at a time can be shared with the student's mentor.
alter table public.planner_scenarios
  add column if not exists shared_with_mentor boolean not null default false;
create unique index if not exists planner_scenarios_one_shared
  on public.planner_scenarios (student_id) where shared_with_mentor;

-- Share one scenario (or none, with null), unsharing any other.
create or replace function public.share_planner_scenario(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.students s where s.id = auth.uid())
     or not public.account_is_active(auth.uid()) then
    raise exception 'Only a student can share a plan';
  end if;
  if p_id is not null and not exists (
       select 1 from public.planner_scenarios s where s.id = p_id and s.student_id = auth.uid()) then
    raise exception 'That scenario is not yours';
  end if;
  update public.planner_scenarios set shared_with_mentor = false
   where student_id = auth.uid() and shared_with_mentor;
  if p_id is not null then
    update public.planner_scenarios set shared_with_mentor = true where id = p_id;
  end if;
end;
$$;
revoke all on function public.share_planner_scenario(uuid) from public, anon;
grant execute on function public.share_planner_scenario(uuid) to authenticated;

-- A mentor's view of their mentee's plan: the plan and record every
-- target is worked out from, and, only if the student has shared one, the
-- scenario and the class they are aiming for.
create or replace function public.get_mentee_graduation_plan(p_student uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shared jsonb;
begin
  if not public.is_my_mentee(p_student) then
    raise exception 'Only this student''s mentor can see their plan';
  end if;

  select jsonb_build_object(
           'name',       s.name,
           'guesses',    s.guesses,
           'plans',      s.plans,
           'past',       s.past,
           'updated_at', s.updated_at,
           'aim',        (select a.class_key from public.planner_aims a where a.student_id = p_student))
    into v_shared
    from public.planner_scenarios s
   where s.student_id = p_student and s.shared_with_mentor;

  return jsonb_build_object(
    'plan', public.graduation_plan_for(p_student),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'grade', r.grade, 'gpv', r.gpv, 'course_id', r.course_id,
               'course_code', c.course_code, 'course_title', c.title, 'semester', c.semester,
               'credits', c.result_credits, 'contributes_to_gpa', c.contributes_to_gpa))
        from public.results r
        join public.courses c on c.id = r.course_id
       where r.student_id = p_student and r.is_published and r.gpv is not null), '[]'::jsonb),
    'shared', v_shared);
end;
$$;
revoke all on function public.get_mentee_graduation_plan(uuid) from public, anon;
grant execute on function public.get_mentee_graduation_plan(uuid) to authenticated;

-- When the last result of a semester a student is enrolled in is published,
-- tell them once: the SGPA, and what the class they are aiming for (else
-- the best one still open) now needs from the semesters ahead.
create or replace function public.nudge_semester_complete(p_student uuid, p_semester integer, p_year text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrolled  int;
  v_missing   int;
  v_sgpa      numeric;
  v_plan      jsonb;
  v_credits   numeric;
  v_points    numeric;
  v_remaining numeric;
  v_final     numeric;
  v_sems      text;
  v_aim       text;
  v_class     record;
  v_required  numeric;
  v_title     text;
  v_body      text;
begin
  -- Complete: every course of the semester enrolled in that year has its
  -- result. A year of repeats alone is not the semester itself, and a
  -- semester with no enrolment rows predates enrolment in PES: nothing to say.
  select count(*) filter (where not exists (
           select 1 from public.results r
            where r.student_id = p_student and r.course_id = e.course_id
              and r.academic_year < p_year)),
         count(*) filter (where not exists (
           select 1 from public.results r
            where r.student_id = p_student and r.course_id = e.course_id
              and r.academic_year = p_year and r.is_published))
    into v_enrolled, v_missing
    from (select distinct e.course_id
            from public.enrollments e
            join public.courses c on c.id = e.course_id
           where e.student_id = p_student and e.status = 'enrolled'
             and e.academic_year = p_year
             and c.semester = p_semester and c.graded_with is null) e;
  if coalesce(v_enrolled, 0) = 0 or v_missing > 0 then
    return;
  end if;

  v_title := 'Semester ' || p_semester || ' results are complete';
  if exists (select 1 from public.notifications n
              where n.recipient_id = p_student and n.kind = 'semester_complete'
                and n.title like v_title || '%') then
    return;
  end if;

  select round(sum(c.result_credits * r.gpv) / nullif(sum(c.result_credits), 0), 2)
    into v_sgpa
    from public.results r
    join public.courses c on c.id = r.course_id
   where r.student_id = p_student and r.is_published and r.gpv is not null
     and c.contributes_to_gpa and c.semester = p_semester;
  if v_sgpa is not null then
    v_title := v_title || ': SGPA ' || to_char(v_sgpa, 'FM0.00');
  end if;

  v_plan      := public.graduation_plan_for(p_student);
  v_credits   := (v_plan #>> '{completed,credits}')::numeric;
  v_points    := (v_plan #>> '{completed,points}')::numeric;
  select coalesce(sum((x->>'credits')::numeric), 0),
         string_agg('Semester ' || (x->>'semester'), ' and ' order by (x->>'semester')::int)
    into v_remaining, v_sems
    from jsonb_array_elements(v_plan->'semesters') x
   where (x->>'credits')::numeric > 0;
  v_final := v_credits + v_remaining;

  select a.class_key into v_aim from public.planner_aims a where a.student_id = p_student;

  if v_remaining = 0 then
    select c->>'label' as label into v_class
      from public.system_settings s, jsonb_array_elements(s.value) c
     where s.key = 'honours_classifications'
       and v_credits > 0 and v_points / v_credits >= (c->>'threshold')::numeric
     order by (c->>'threshold')::numeric desc limit 1;
    v_body := 'Your CGPA is ' || to_char(round(v_points / nullif(v_credits, 0), 2), 'FM0.00')
           || coalesce(': ' || v_class.label, '') || '.';
  else
    -- The aim if there is one; else the best class still open.
    select c->>'label' as label, (c->>'threshold')::numeric as threshold,
           ((c->>'threshold')::numeric * v_final - v_points) / v_remaining as required
      into v_class
      from public.system_settings s, jsonb_array_elements(s.value) c
     where s.key = 'honours_classifications'
     order by (c->>'key') = coalesce(v_aim, '') desc,
              (((c->>'threshold')::numeric * v_final - v_points) / v_remaining between 0.0001 and 4) desc,
              (c->>'threshold')::numeric desc
     limit 1;
    v_required := v_class.required;
    v_body := case
      when v_required <= 0 then
        v_class.label || ' is secured: even a 0.00 average from here keeps you above '
          || to_char(v_class.threshold, 'FM0.00') || '.'
      when v_required > 4 then
        v_class.label || ' now needs more than a 4.00 average. The Graduation Planner shows what is still within reach.'
      else
        'To finish with ' || v_class.label || ', you now need an SGPA of '
          || to_char(v_required, 'FM0.00') || ' in ' || v_sems || '.'
    end;
  end if;

  perform public.notify_user(p_student, 'results', 'semester_complete', v_title, v_body,
                             '/app/planner', 'semester', null);
end;
$$;
revoke all on function public.nudge_semester_complete(uuid, integer, text) from public, anon, authenticated;

-- Called from the trigger that announces published results. A failure here
-- is logged and never stops a sheet from being published.
do $$
declare
  v_def text;
  v_old text := E'  return null;\nend;';
begin
  select pg_get_functiondef('public.notify_result_changes'::regproc) into v_def;
  if v_def like '%nudge_semester_complete%' then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'notify_result_changes: end of function not found exactly once';
  end if;
  v_def := replace(v_def, v_old, E'  -- A semester whose last result has just been published.\n'
    || E'  for r in\n'
    || E'    select distinct n.student_id, c.semester, n.academic_year\n'
    || E'      from new_rows n\n'
    || E'      join old_rows o on o.id = n.id\n'
    || E'      join public.courses c on c.id = n.course_id\n'
    || E'     where n.status = ''published'' and o.status is distinct from ''published''\n'
    || E'  loop\n'
    || E'    begin\n'
    || E'      perform public.nudge_semester_complete(r.student_id, r.semester, r.academic_year);\n'
    || E'    exception when others then\n'
    || E'      raise warning ''semester notice for % failed: %'', r.student_id, sqlerrm;\n'
    || E'    end;\n'
    || E'  end loop;\n\n'
    || v_old);
  execute v_def;
end $$;
