-- A course taught over two semesters, graded once at the end.
--
-- Some courses are delivered in two parts under one code. Computer
-- Engineering's minor projects are the case at hand: the Data Management
-- Project and the High Performance Computing Project are 3 credits in
-- Semester 6 and 2 in Semester 7, and the student receives one grade, in
-- Semester 7, for all 5. The catalogue keeps the two parts, because that is
-- how the handbook prints the curriculum and how a student enrols and counts
-- towards a minor. What it did not know was that the first part never gets a
-- result of its own, and that the final one is worth both parts' credits.
--
-- graded_with marks an earlier part as graded together with a later one.
-- result_credits is the weight a published result carries in the GPA: the
-- course's own credits, plus those of any earlier part graded with it, and
-- nothing for an earlier part, which is never graded itself. Every GPA
-- computation now reads result_credits, so the 5 credits count once, in the
-- semester the grade is awarded. For every other course result_credits is
-- simply its credits, so no existing figure changes.

alter table public.courses
  add column if not exists graded_with uuid references public.courses (id) on delete restrict,
  add column if not exists result_credits integer;

comment on column public.courses.graded_with is
  'An earlier part of a course taught over two semesters: the later part it is graded together with.';
comment on column public.courses.result_credits is
  'Credits a published result for this course carries in the GPA. Maintained from credits and graded_with.';

-- The link has to describe a real continuation: the same course, carried on in
-- a later semester, ending in a part that is itself graded.
create or replace function public.check_course_graded_with()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_final record;
begin
  if new.graded_with is null
     or (tg_op = 'UPDATE' and new.graded_with is not distinct from old.graded_with) then
    return new;
  end if;

  select f.id, f.course_code, f.department, f.semester, f.graded_with
    into v_final
    from public.courses f where f.id = new.graded_with;

  if v_final.id = new.id
     or v_final.course_code <> new.course_code
     or v_final.department is distinct from new.department
     or v_final.semester <= new.semester then
    raise exception '% can only be graded with a later semester''s part of the same course', new.course_code;
  end if;
  if v_final.graded_with is not null then
    raise exception 'The part % is graded with is itself carried on; link to the final part', new.course_code;
  end if;
  if exists (select 1 from public.courses p where p.graded_with = new.id) then
    raise exception '% is the final part of another course and cannot be carried on itself', new.course_code;
  end if;
  if exists (select 1 from public.results r where r.course_id = new.id) then
    raise exception '% already has results of its own; it cannot become an ungraded part', new.course_code;
  end if;
  return new;
end;
$$;

drop trigger if exists courses_check_graded_with on public.courses;
create trigger courses_check_graded_with
  before insert or update of graded_with on public.courses
  for each row execute function public.check_course_graded_with();

-- A new course carries its own credits until the refresh below says otherwise.
create or replace function public.courses_default_result_credits()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.result_credits := coalesce(new.result_credits, new.credits);
  return new;
end;
$$;

drop trigger if exists courses_default_result_credits on public.courses;
create trigger courses_default_result_credits
  before insert on public.courses
  for each row execute function public.courses_default_result_credits();

-- result_credits follows credits and graded_with, whoever edits them, and is
-- recomputed after every change to the catalogue rather than trusted as typed.
create or replace function public.refresh_result_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The update below fires this trigger again; there is nothing more to do.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  update public.courses c
     set result_credits = v.rc
    from (select c2.id,
                 case when c2.graded_with is not null then 0
                      else c2.credits + coalesce((select sum(p.credits)
                                                    from public.courses p
                                                   where p.graded_with = c2.id), 0)
                 end as rc
            from public.courses c2) v
   where v.id = c.id
     and c.result_credits is distinct from v.rc;
  return null;
end;
$$;

drop trigger if exists courses_refresh_result_credits on public.courses;
create trigger courses_refresh_result_credits
  after insert or update or delete on public.courses
  for each statement execute function public.refresh_result_credits();

update public.courses set result_credits = credits where result_credits is null;

-- The two minor projects: one grade, in Semester 7, for all 5 credits.
do $$
declare
  v_n int;
begin
  update public.courses p
     set graded_with = f.id
    from public.courses f
   where p.course_code in ('CO3554', 'CO3563')
     and p.semester = 6
     and f.course_code = p.course_code
     and f.semester = 7
     and p.graded_with is null;
  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception 'Expected to link 2 Semester 6 project parts, linked %', v_n;
  end if;
end $$;

alter table public.courses alter column result_credits set not null;

-- An earlier part has no result of its own. Saying so where a result would be
-- entered is kinder than a GPA that quietly counts the credits twice.
create or replace function public.results_refuse_ungraded_part()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part  record;
  v_final record;
begin
  select c.course_code, c.semester, c.graded_with into v_part
    from public.courses c where c.id = new.course_id;
  if v_part.graded_with is null then
    return new;
  end if;

  select f.semester, f.result_credits into v_final
    from public.courses f where f.id = v_part.graded_with;
  raise exception '% has no result of its own in Semester %. It is graded once, with its Semester % part, for % credits.',
    v_part.course_code, v_part.semester, v_final.semester, v_final.result_credits
    using hint = 'Enter the result on the Semester ' || v_final.semester || ' result sheet for ' || v_part.course_code || '.';
end;
$$;

drop trigger if exists results_000_refuse_ungraded_part on public.results;
create trigger results_000_refuse_ungraded_part
  before insert or update of course_id on public.results
  for each row execute function public.results_refuse_ungraded_part();

-- Every GPA computation weighs a result by the credits it carries. In each of
-- these functions courses are joined as "c" to the results being counted, and
-- c.credits is read only for that, so the change is the same everywhere. The
-- count of uses is checked first, so a function that has changed since this
-- was written stops the migration instead of being rewritten blind.
do $$
declare
  f     record;
  v_def text;
  v_n   int;
begin
  for f in
    select * from (values
      ('export_batch_records',            1),
      ('get_all_students_academic_stats', 2),
      ('get_department_mentor_roster',    2),
      ('get_department_students',         2),
      ('get_mentee_academic_overview',    6),
      ('get_my_academic_record',          1),
      ('get_my_mentees',                  1),
      ('get_published_result_sheet',      1),
      ('get_student_academic_record',     1),
      ('get_student_course_result',       1),
      ('get_student_results',             3)
    ) as t(fn, expected)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f.fn;
    if v_def is null then
      raise exception 'Function % not found', f.fn;
    end if;

    v_n := (length(v_def) - length(replace(v_def, 'c.credits', ''))) / length('c.credits');
    if v_n <> f.expected then
      raise exception '%: expected % uses of c.credits, found %', f.fn, f.expected, v_n;
    end if;
    v_def := replace(v_def, 'c.credits', 'c.result_credits');

    -- A semester is complete when everything enrolled in it has a result. An
    -- earlier part never will, so it is not waited for.
    if f.fn = 'get_my_academic_record' then
      if position('and c.semester = s.semester) as enrolled' in v_def) = 0 then
        raise exception 'get_my_academic_record: enrolled count not found';
      end if;
      v_def := replace(v_def, 'and c.semester = s.semester) as enrolled',
                       'and c.semester = s.semester' || chr(10) ||
                       '               and c.graded_with is null) as enrolled');
    end if;

    execute v_def;
  end loop;
end $$;

-- The two views over results, the same way. Their columns are unchanged:
-- "credits" is the weight of the result.
create or replace view public.my_published_results as
 select r.id,
    r.student_id,
    r.course_id,
    r.offering_id,
    r.academic_year,
    r.mid_sem_mark,
    r.ca_mark,
    r.grade,
    r.gpv,
    r.published_at,
    c.course_code,
    c.title as course_title,
    c.result_credits as credits,
    c.semester,
    c.year as course_year,
    c.category,
    c.minor_category,
    c.contributes_to_gpa,
    c.department as course_department,
    r.original_grade,
    row_number() over (partition by r.course_id order by r.academic_year, r.published_at nulls first) as attempt_number,
    (count(*) over (partition by r.course_id) > 1) as has_repeat,
    (row_number() over (partition by r.course_id order by r.academic_year desc, r.published_at desc nulls last) = 1) as is_latest_attempt
   from results r
     join courses c on c.id = r.course_id
  where r.student_id = auth.uid() and r.is_published = true;

create or replace view public.student_gpa_summary
with (security_invoker = true) as
 select r.student_id,
    r.academic_year,
    c.semester,
    round((sum(r.gpv * c.result_credits::double precision)
           / nullif(sum(case when r.gpv is not null then c.result_credits else null::integer end), 0)::double precision)::numeric, 2) as sgpa,
    round((sum(r.gpv * c.result_credits::double precision) over (partition by r.student_id)
           / nullif(sum(case when r.gpv is not null then c.result_credits else null::integer end) over (partition by r.student_id), 0)::double precision)::numeric, 2) as cgpa
   from results r
     join courses c on c.id = r.course_id
  where r.is_published = true and c.contributes_to_gpa = true
  group by r.student_id, r.academic_year, c.semester, r.gpv, c.result_credits;

-- The GPA credits a semester of the curriculum will carry, as the handbook's
-- baskets set it out: every compulsory course that counts, plus what each
-- elective basket asks for. A basket of courses that do not count adds
-- nothing, and an optional one is not required. Credits are counted where the
-- grade is awarded, so the Semester 6 part of a minor project adds nothing to
-- Semester 6 and its 3 credits arrive with the Semester 7 grade. Null when the
-- curriculum does not say (a semester after the first year, for a student not
-- yet in a department).
create or replace function public.curriculum_gpa_credits(p_department text, p_semester integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with slot as (
    select s.basket, s.required_credits, c.credits, c.result_credits, c.contributes_to_gpa
      from public.curriculum_slots s
      join public.courses c on c.id = s.course_id
     where s.department = case when p_semester <= 2 then 'COMMON' else p_department end
       and s.semester = p_semester
  ),
  basket as (
    select basket,
           max(required_credits)                            as required,
           bool_and(contributes_to_gpa)                     as all_count,
           sum(result_credits) filter (where contributes_to_gpa) as weighed,
           sum(credits)        filter (where contributes_to_gpa) as listed
      from slot
     group by basket
  )
  select case when not exists (select 1 from slot) then null
              else coalesce(sum(
                     case when basket = 'Compulsory' then coalesce(weighed, 0)
                          when basket ilike 'Optional%' then 0
                          when all_count and listed > 0
                            then round(coalesce(required, 0) * weighed::numeric / listed)
                          else 0
                     end), 0)::int
         end
    from basket;
$$;

revoke all on function public.curriculum_gpa_credits(text, integer) from public, anon;
grant execute on function public.curriculum_gpa_credits(text, integer) to authenticated, service_role;

-- Everything the Graduation Planner needs, in one place, so the planner and
-- the assistant work from the same numbers:
--   completed: the GPA credits and grade points already on the record (a
--              superseded attempt carries no grade point, so it is not here);
--   courses:   what the student is sitting now, enrolled with no result yet;
--   semesters: each semester still to come and the GPA credits it will carry,
--              from the student's enrolment for the semester in progress and
--              from the curriculum after that.
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
    'courses',   v_courses);
end;
$$;

revoke all on function public.get_my_graduation_plan() from public, anon;
grant execute on function public.get_my_graduation_plan() to authenticated;

-- The assistant's two planning tools, on the same footing as the planner.
-- They used the degree's 144 credits as if all of them were GPA credits, so
-- they promised the student more remaining credits than there are, and an
-- easier target than the true one.
create or replace function public.get_academic_standing()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan      jsonb := public.get_my_graduation_plan();
  v_index     text;
  v_credits   numeric := (v_plan #>> '{completed,credits}')::numeric;
  v_points    numeric := (v_plan #>> '{completed,points}')::numeric;
  v_last      int     := (v_plan #>> '{completed,last_semester}')::int;
  v_remaining numeric;
  v_cgpa      numeric := 0;
begin
  select index_number into v_index from public.students where id = auth.uid();
  select coalesce(sum((x->>'credits')::numeric), 0) into v_remaining
    from jsonb_array_elements(v_plan->'semesters') x;

  if v_credits > 0 then
    v_cgpa := round(v_points / v_credits, 2);
  end if;

  return jsonb_build_object(
    'department', v_plan->>'department',
    'index_number', v_index,
    'current_cgpa', v_cgpa,
    'credits_completed', v_credits,
    'credits_remaining', v_remaining,
    'highest_completed_semester', v_last,
    'next_semester', v_last + 1,
    'current_classification', case
      when v_cgpa >= 3.70 then 'First Class Honours'
      when v_cgpa >= 3.30 then 'Second Class Honours (Upper Division)'
      when v_cgpa >= 3.00 then 'Second Class Honours (Lower Division)'
      when v_cgpa >= 2.00 then 'Pass'
      else 'Below Pass'
    end
  );
end;
$$;

create or replace function public.calculate_gpa_target(p_target_cgpa numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan      jsonb;
  v_credits   numeric;
  v_points    numeric;
  v_cgpa      numeric := 0;
  v_remaining numeric;
  v_final     numeric;
  v_required  numeric;
begin
  if p_target_cgpa is null or p_target_cgpa < 0 or p_target_cgpa > 4.0 then
    return jsonb_build_object('error', 'target_cgpa must be between 0 and 4.0');
  end if;

  v_plan    := public.get_my_graduation_plan();
  v_credits := (v_plan #>> '{completed,credits}')::numeric;
  v_points  := (v_plan #>> '{completed,points}')::numeric;
  select coalesce(sum((x->>'credits')::numeric), 0) into v_remaining
    from jsonb_array_elements(v_plan->'semesters') x;

  if v_credits > 0 then
    v_cgpa := v_points / v_credits;
  end if;
  if v_remaining = 0 then
    return jsonb_build_object(
      'already_graduated_credits', true,
      'current_cgpa', round(v_cgpa, 2));
  end if;

  -- The final CGPA is over every GPA credit the degree will carry: those
  -- already graded and those still to come.
  v_final    := v_credits + v_remaining;
  v_required := (p_target_cgpa * v_final - v_points) / v_remaining;

  return jsonb_build_object(
    'current_cgpa', round(v_cgpa, 2),
    'credits_completed', v_credits,
    'remaining_credits', v_remaining,
    'final_gpa_credits', v_final,
    'target_cgpa', p_target_cgpa,
    -- The same SGPA in every remaining semester reaches the target: the CGPA
    -- is credit-weighted, so a heavier semester moves it more, but holding
    -- this average in each one lands exactly on it.
    'required_avg_sgpa_per_remaining_semester', round(greatest(0, least(4.0, v_required)), 2),
    'raw_required_avg', round(v_required, 3),
    'already_secured', v_required <= 0,
    'feasible', v_required <= 4.0,
    'best_possible_cgpa', round((v_points + v_remaining * 4.0) / v_final, 2),
    'semester_breakdown', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'semester', (x->>'semester')::int,
               'estimated_credits', (x->>'credits')::int,
               'source', x->>'source',
               'required_sgpa', round(greatest(0, least(4.0, v_required)), 2))
               order by (x->>'semester')::int), '[]'::jsonb)
        from jsonb_array_elements(v_plan->'semesters') x)
  );
end;
$$;
