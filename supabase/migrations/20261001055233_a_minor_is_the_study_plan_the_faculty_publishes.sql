-- A minor is the study plan the faculty publishes.
--
-- The department's "Minors - Study Plan" sets each minor out as a table:
-- for Semesters 5 to 8, a few baskets of courses, each with the minimum
-- credits a student must take from it, and in every semester one course in
-- red that the minor cannot do without. Twenty credits claim the minor.
--
-- What the system had was one minor tag per course (courses.minor_category)
-- and a credit total of 5. Neither can say what the plan says: Data Mining,
-- Distributed Systems and Machine Learning belong to both minors; the two
-- project courses count 3 credits in Semester 6 and 2 in Semester 7; and a
-- tag cannot say "mandatory" or "at least 2 credits from these two". So the
-- plan gets tables of its own, edited by the department, and the enrolment
-- page draws its minor table from them rather than from anything written
-- into the page.
--
--   minor_plan_baskets  one basket of one minor in one semester: its place
--                       in the table, the minimum credits, whether it is the
--                       mandatory (red) one
--   minor_plan_courses  the courses in a basket, with the credits the plan
--                       counts for them there
--   student_minor_choices
--                       which minor a student has said they are taking, so
--                       enrolment can warn before they leave out its
--                       mandatory course
--
-- Both plan tables hang off minor_requirements by (department, minor) with
-- ON UPDATE / ON DELETE CASCADE, so renaming or removing a minor through the
-- existing functions carries the plan with it.

-- The plan's own name for the second minor, and the total it states.
update public.minor_requirements
   set minor = 'High Performance Computing'
 where department = 'Computer Engineering' and minor = 'High-Performance Computing';
update public.courses
   set minor_category = 'High Performance Computing'
 where department = 'Computer Engineering' and minor_category = 'High-Performance Computing';
update public.minor_requirements
   set required_credits = 20
 where department = 'Computer Engineering'
   and minor in ('Data Management', 'High Performance Computing');

create table if not exists public.minor_plan_baskets (
  id          uuid primary key default gen_random_uuid(),
  department  text    not null,
  minor       text    not null,
  semester    integer not null check (semester between 1 and 8),
  -- Order within the semester, as the table prints it.
  position    integer not null default 1,
  min_credits integer not null check (min_credits >= 0),
  -- The basket printed in red: every course in it is required.
  mandatory   boolean not null default false,
  created_at  timestamptz not null default now(),
  foreign key (department, minor)
    references public.minor_requirements (department, minor)
    on update cascade on delete cascade
);
create index if not exists minor_plan_baskets_lookup
  on public.minor_plan_baskets (department, minor, semester, position);

create table if not exists public.minor_plan_courses (
  basket_id uuid    not null references public.minor_plan_baskets (id) on delete cascade,
  course_id uuid    not null references public.courses (id) on delete cascade,
  -- As the plan counts it in this semester, which for a project running over
  -- two semesters is not the catalogue's figure for the whole course.
  credits   integer not null check (credits > 0),
  position  integer not null default 1,
  primary key (basket_id, course_id)
);
create index if not exists minor_plan_courses_course on public.minor_plan_courses (course_id);

alter table public.minor_plan_baskets enable row level security;
alter table public.minor_plan_courses enable row level security;

-- Public inside the faculty, like the curriculum: a student needs it to
-- choose. Written by whoever may manage the department's minors.
drop policy if exists minor_plan_baskets_read on public.minor_plan_baskets;
create policy minor_plan_baskets_read on public.minor_plan_baskets
  for select to authenticated using (true);
drop policy if exists minor_plan_baskets_write on public.minor_plan_baskets;
create policy minor_plan_baskets_write on public.minor_plan_baskets
  for all to authenticated
  using (public.may_manage_minors(department))
  with check (public.may_manage_minors(department));

drop policy if exists minor_plan_courses_read on public.minor_plan_courses;
create policy minor_plan_courses_read on public.minor_plan_courses
  for select to authenticated using (true);
drop policy if exists minor_plan_courses_write on public.minor_plan_courses;
create policy minor_plan_courses_write on public.minor_plan_courses
  for all to authenticated
  using (exists (select 1 from public.minor_plan_baskets b
                  where b.id = basket_id and public.may_manage_minors(b.department)))
  with check (exists (select 1 from public.minor_plan_baskets b
                       where b.id = basket_id and public.may_manage_minors(b.department)));

create table if not exists public.student_minor_choices (
  student_id uuid primary key references public.students (id) on delete cascade,
  department text not null,
  minor      text not null,
  chosen_at  timestamptz not null default now(),
  foreign key (department, minor)
    references public.minor_requirements (department, minor)
    on update cascade on delete cascade
);
alter table public.student_minor_choices enable row level security;

-- A student reads their own; the department's managers read their students'.
-- Writes go through set_my_minor.
drop policy if exists student_minor_choices_read on public.student_minor_choices;
create policy student_minor_choices_read on public.student_minor_choices
  for select to authenticated
  using (student_id = auth.uid() or public.may_manage_minors(department));

-- The plan as the Computer Engineering study plan prints it, row for row.
do $$
declare
  v_expected int;
  v_inserted int;
begin
  if exists (select 1 from public.minor_plan_baskets where department = 'Computer Engineering') then
    return;
  end if;

  insert into public.minor_plan_baskets (department, minor, semester, position, min_credits, mandatory)
  select 'Computer Engineering', v.minor, v.semester, v.position, v.min_credits, v.mandatory
    from (values
      ('Data Management',            5, 1, 2, false),
      ('Data Management',            5, 2, 3, true),
      ('Data Management',            6, 1, 3, true),
      ('Data Management',            6, 2, 2, false),
      ('Data Management',            7, 1, 2, true),
      ('Data Management',            7, 2, 3, false),
      ('Data Management',            8, 1, 3, true),
      ('Data Management',            8, 2, 2, false),
      ('High Performance Computing', 5, 1, 2, false),
      ('High Performance Computing', 5, 2, 3, true),
      ('High Performance Computing', 6, 1, 3, true),
      ('High Performance Computing', 6, 2, 2, false),
      ('High Performance Computing', 7, 1, 2, true),
      ('High Performance Computing', 7, 2, 3, false),
      ('High Performance Computing', 8, 1, 3, true),
      ('High Performance Computing', 8, 2, 2, false)
    ) as v (minor, semester, position, min_credits, mandatory);

  with plan (minor, semester, basket, code, credits, position) as (values
      ('Data Management',            5, 1, 'CO3251', 2, 1),
      ('Data Management',            5, 1, 'CO3252', 2, 2),
      ('Data Management',            5, 2, 'CO3353', 3, 1),
      ('Data Management',            6, 1, 'CO3554', 3, 1),
      ('Data Management',            6, 2, 'CO3255', 2, 1),
      ('Data Management',            6, 2, 'CO3256', 2, 2),
      ('Data Management',            7, 1, 'CO3554', 2, 1),
      ('Data Management',            7, 2, 'CO4351', 3, 1),
      ('Data Management',            7, 2, 'CO4352', 3, 2),
      ('Data Management',            8, 1, 'CO4353', 3, 1),
      ('Data Management',            8, 2, 'CO4254', 2, 1),
      ('Data Management',            8, 2, 'CO4255', 2, 2),
      ('Data Management',            8, 2, 'CO4256', 2, 3),
      ('High Performance Computing', 5, 1, 'CO3261', 2, 1),
      ('High Performance Computing', 5, 1, 'CO3262', 2, 2),
      ('High Performance Computing', 5, 2, 'CO3353', 3, 1),
      ('High Performance Computing', 6, 1, 'CO3563', 3, 1),
      ('High Performance Computing', 6, 2, 'CO3264', 2, 1),
      ('High Performance Computing', 6, 2, 'CO3265', 2, 2),
      ('High Performance Computing', 7, 1, 'CO3563', 2, 1),
      ('High Performance Computing', 7, 2, 'CO4361', 3, 1),
      ('High Performance Computing', 7, 2, 'CO4362', 3, 2),
      ('High Performance Computing', 8, 1, 'CO4353', 3, 1),
      ('High Performance Computing', 8, 2, 'CO4254', 2, 1),
      ('High Performance Computing', 8, 2, 'CO4263', 2, 2)
  )
  insert into public.minor_plan_courses (basket_id, course_id, credits, position)
  select b.id, cs.course_id, p.credits, p.position
    from plan p
    join public.minor_plan_baskets b
      on b.department = 'Computer Engineering' and b.minor = p.minor
     and b.semester = p.semester and b.position = p.basket
    -- The course the curriculum lists in that semester, so a code that
    -- exists once per semester resolves to the right row.
    join public.curriculum_slots cs
      on cs.department = 'Computer Engineering' and cs.semester = p.semester
    join public.courses c on c.id = cs.course_id and c.course_code = p.code;

  get diagnostics v_inserted = row_count;
  v_expected := 25;
  if v_inserted <> v_expected then
    raise exception 'Minor plan seed placed % of % courses', v_inserted, v_expected;
  end if;
end $$;

-- The plan of a department's minors, without any student in it: for the
-- screen that edits it and for anyone reading it.
create or replace function public.get_department_minor_plan(p_department text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'minor', mr.minor,
           'required_credits', mr.required_credits,
           'baskets', coalesce(bk.baskets, '[]'::jsonb))
         order by mr.minor), '[]'::jsonb)
    from public.minor_requirements mr
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'semester', b.semester, 'position', b.position,
               'min_credits', b.min_credits, 'mandatory', b.mandatory,
               'courses', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'course_id', mc.course_id, 'course_code', c.course_code,
                          'title', c.title, 'credits', mc.credits,
                          'catalogue_credits', c.credits, 'position', mc.position)
                        order by mc.position, c.course_code)
                   from public.minor_plan_courses mc
                   join public.courses c on c.id = mc.course_id
                  where mc.basket_id = b.id), '[]'::jsonb))
             order by b.semester, b.position) as baskets
        from public.minor_plan_baskets b
       where b.department = mr.department and b.minor = mr.minor
    ) bk on true
   where mr.department = p_department;
$$;
revoke all on function public.get_department_minor_plan(text) from public, anon;
grant execute on function public.get_department_minor_plan(text) to authenticated;

-- The plan with one student's standing in every row.
--
-- A course is passed (a published passing grade, in any year), enrolled (an
-- enrolment in the academic year that semester falls in, so the Semester 6
-- and Semester 7 halves of a project are told apart), failed, or none. A
-- basket is met when its counted credits reach its minimum, or for the
-- mandatory basket when all of it is counted. The minor is complete when
-- every basket is met by passed courses and the passed credits reach the
-- total.
--
-- Internal: get_my_enrolment_plan and get_my_minor_progress call it for the
-- student asking.
create or replace function public.student_minor_plan(
  p_student uuid, p_current_sem integer, p_current_year text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with st as (
    select s.id, s.department, s.batch_year from public.students s where s.id = p_student
  ),
  course_rows as (
    select b.department, b.minor, b.id as basket_id, b.semester,
           b.position as basket_position, b.min_credits, b.mandatory,
           mc.course_id, mc.credits, mc.position as course_position,
           c.course_code, c.title, g.grade,
           (g.grade is not null and g.grade not in ('R', 'L', 'F')) as passed,
           exists (
             select 1 from public.enrollments e
              where e.student_id = st.id and e.course_id = mc.course_id
                and e.status = 'enrolled'
                and e.academic_year = case
                      when b.semester = p_current_sem then p_current_year
                      else (st.batch_year + ceil(b.semester / 2.0)::int - 1)::text || '/'
                        || (st.batch_year + ceil(b.semester / 2.0)::int)::text
                    end) as enrolled
      from st
      join public.minor_plan_baskets b on b.department = st.department
      left join public.minor_plan_courses mc on mc.basket_id = b.id
      left join public.courses c on c.id = mc.course_id
      left join lateral (
        select r.grade from public.results r
         where r.student_id = st.id and r.course_id = mc.course_id and r.is_published
         order by (r.grade not in ('R', 'L', 'F')) desc, r.academic_year desc
         limit 1
      ) g on true
  ),
  statused as (
    select cr.*,
           case when cr.passed then 'passed'
                when cr.enrolled then 'enrolled'
                when cr.grade is not null then 'failed'
                else 'none' end as status
      from course_rows cr
  ),
  baskets as (
    select department, minor, basket_id, semester, basket_position, min_credits, mandatory,
           coalesce(sum(credits) filter (where status in ('passed', 'enrolled')), 0)::int
             as counted_credits,
           coalesce(sum(credits) filter (where status = 'passed'), 0)::int as passed_credits,
           case when mandatory
                then coalesce(bool_and(status in ('passed', 'enrolled'))
                                filter (where course_id is not null), false)
                else coalesce(sum(credits) filter (where status in ('passed', 'enrolled')), 0)
                       >= min_credits end as met,
           case when mandatory
                then coalesce(bool_and(status = 'passed') filter (where course_id is not null), false)
                else coalesce(sum(credits) filter (where status = 'passed'), 0) >= min_credits
           end as passed_met,
           coalesce(jsonb_agg(jsonb_build_object(
             'course_id', course_id, 'course_code', course_code, 'title', title,
             'credits', credits, 'status', status, 'grade', grade)
             order by course_position, course_code)
             filter (where course_id is not null), '[]'::jsonb) as courses
      from statused
     group by department, minor, basket_id, semester, basket_position, min_credits, mandatory
  ),
  minors as (
    select mr.minor, mr.required_credits,
           coalesce(sum(bk.passed_credits), 0)::int as earned_credits,
           coalesce(sum(bk.counted_credits - bk.passed_credits), 0)::int as planned_credits,
           (coalesce(bool_and(bk.passed_met), false)
             and coalesce(sum(bk.passed_credits), 0) >= mr.required_credits) as complete,
           coalesce(jsonb_agg(jsonb_build_object(
             'id', bk.basket_id, 'semester', bk.semester, 'position', bk.basket_position,
             'min_credits', bk.min_credits, 'mandatory', bk.mandatory,
             'counted_credits', bk.counted_credits, 'met', bk.met, 'courses', bk.courses)
             order by bk.semester, bk.basket_position)
             filter (where bk.basket_id is not null), '[]'::jsonb) as baskets
      from st
      join public.minor_requirements mr on mr.department = st.department
      left join baskets bk on bk.department = mr.department and bk.minor = mr.minor
     group by mr.minor, mr.required_credits
  )
  select jsonb_build_object(
    'chosen_minor',
      (select smc.minor from public.student_minor_choices smc where smc.student_id = p_student),
    'minors',
      coalesce((select jsonb_agg(jsonb_build_object(
                  'minor', m.minor, 'required_credits', m.required_credits,
                  'earned_credits', m.earned_credits, 'planned_credits', m.planned_credits,
                  'complete', m.complete, 'baskets', m.baskets)
                order by m.minor)
                  from minors m), '[]'::jsonb));
$$;
revoke all on function public.student_minor_plan(uuid, integer, text) from public, anon, authenticated;

-- A student says which minor they are taking, or that they are taking none.
create or replace function public.set_my_minor(p_minor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department text;
begin
  select s.department into v_department
    from public.students s where s.id = auth.uid() and s.role = 'student';
  if v_department is null then
    raise exception 'Only a student can choose a minor';
  end if;

  if p_minor is null or btrim(p_minor) = '' then
    delete from public.student_minor_choices where student_id = auth.uid();
    return jsonb_build_object('ok', true, 'minor', null);
  end if;

  if not exists (select 1 from public.minor_requirements
                  where department = v_department and minor = p_minor) then
    raise exception 'Your department has no minor called %', p_minor;
  end if;

  insert into public.student_minor_choices (student_id, department, minor)
  values (auth.uid(), v_department, p_minor)
  on conflict (student_id) do update
     set department = excluded.department, minor = excluded.minor, chosen_at = now();
  return jsonb_build_object('ok', true, 'minor', p_minor);
end;
$$;
revoke all on function public.set_my_minor(text) from public, anon;
grant execute on function public.set_my_minor(text) to authenticated;

-- The enrolment plan reads minors from the study plan. A course's `minor` is
-- now the minors whose plan lists it in this semester, and the plan itself
-- comes back as `minor_plan`. `minors` keeps its earlier shape for the page
-- already deployed.
create or replace function public.get_my_enrolment_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_student  record;
  v_sem      integer;
  v_dept_key text;
  v_year     text;
  v_win_year text;
  v_baskets  jsonb;
  v_minors   jsonb;
  v_plan     jsonb;
  v_window   jsonb;
begin
  select s.id, s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student.id is null then
    raise exception 'Only a student has an enrolment plan';
  end if;

  v_sem := public.current_semester_for_batch(v_student.batch_year);
  v_dept_key := case when v_sem <= 2 then 'COMMON' else v_student.department end;
  v_year := (v_student.batch_year + ceil(v_sem / 2.0)::int - 1)::text || '/'
          || (v_student.batch_year + ceil(v_sem / 2.0)::int)::text;

  select to_jsonb(w), w.academic_year into v_window, v_win_year
    from (select p.id as period_id, p.title, p.opens_at, p.closes_at,
                 p.academic_year,
                 (p.status = 'open' and now() between p.opens_at and p.closes_at)
                   as is_open
            from public.enrollment_periods p
           where (p.department is null or p.department = v_student.department)
             and p.semester = v_sem
           order by (p.status = 'open' and now() between p.opens_at and p.closes_at) desc,
                    p.closes_at desc
           limit 1) w;

  v_win_year := coalesce(v_win_year, v_year);

  with slot as (
    select s.basket, s.required_credits, c.id as course_id, c.course_code,
           c.title, c.credits, c.contributes_to_gpa,
           (select string_agg(distinct b.minor, ' · ' order by b.minor)
              from public.minor_plan_courses mc
              join public.minor_plan_baskets b on b.id = mc.basket_id
             where mc.course_id = c.id
               and b.department = v_student.department
               and b.semester = v_sem) as minor_names,
           exists (select 1 from public.enrollments e
                    where e.student_id = v_student.id
                      and e.course_id = c.id
                      and e.academic_year = v_win_year
                      and e.status = 'enrolled') as selected,
           exists (select 1 from public.results r
                    where r.student_id = v_student.id
                      and r.course_id = c.id
                      and r.is_published
                      and r.grade not in ('R', 'L', 'F')) as already_passed,
           exists (select 1 from public.results r
                    where r.student_id = v_student.id
                      and r.course_id = c.id
                      and r.academic_year = v_win_year) as locked,
           public.enrolment_kind_for_course(c.id) is not null as enrollable
      from public.curriculum_slots s
      join public.courses c on c.id = s.course_id
     where s.department = v_dept_key and s.semester = v_sem
  )
  select jsonb_agg(b order by b->>'sort_key')
    into v_baskets
    from (
      select jsonb_build_object(
               'sort_key', case when basket = 'Compulsory' then '0'
                                when basket = 'Optional' then '2' else '1' end || basket,
               'basket', basket,
               'required_credits', max(required_credits),
               'selected_credits',
                 coalesce(sum(credits) filter (where selected), 0),
               'earned_credits',
                 coalesce(sum(credits) filter (where already_passed), 0),
               'available_credits', sum(credits),
               'offered_now',
                 coalesce(bool_or(enrollable and not selected and not already_passed), false),
               'courses', jsonb_agg(jsonb_build_object(
                   'course_id', course_id, 'course_code', course_code,
                   'title', title, 'credits', credits,
                   'contributes_to_gpa', contributes_to_gpa,
                   'minor', minor_names,
                   'selected', selected,
                   'already_passed', already_passed,
                   'locked', locked,
                   'enrollable', enrollable)
                 order by course_code)) as b
        from slot
       group by basket
    ) t;

  v_plan := public.student_minor_plan(v_student.id, v_sem, v_win_year);

  select jsonb_agg(jsonb_build_object(
           'minor', m->>'minor',
           'required_credits', (m->>'required_credits')::int,
           'earned_credits', (m->>'earned_credits')::int,
           'selected_credits', (m->>'planned_credits')::int,
           'status', case
             when (m->>'earned_credits')::int + (m->>'planned_credits')::int
                    >= (m->>'required_credits')::int then 'complete'
             when (m->>'earned_credits')::int + (m->>'planned_credits')::int > 0 then 'partial'
             else 'none' end)
         order by m->>'minor')
    into v_minors
    from jsonb_array_elements(v_plan->'minors') m;

  return jsonb_build_object(
    'semester',      v_sem,
    'academic_year', v_year,
    'department',    v_student.department,
    'curriculum_of', v_dept_key,
    'window',        v_window,
    'baskets',       coalesce(v_baskets, '[]'::jsonb),
    'minors',        coalesce(v_minors, '[]'::jsonb),
    'minor_plan',    v_plan);
end;
$function$;

-- The assistant reads the same plan, with the student's standing in it.
create or replace function public.get_my_minor_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_student record;
  v_sem     integer;
  v_year    text;
  v_plan    jsonb;
begin
  select s.id, s.department, s.batch_year into v_student
    from public.students s where s.id = auth.uid();
  if v_student.id is null then
    return jsonb_build_object('minors', '[]'::jsonb,
                              'note', 'Only a student has minor progress.');
  end if;

  v_sem := public.current_semester_for_batch(v_student.batch_year);
  v_year := (v_student.batch_year + ceil(v_sem / 2.0)::int - 1)::text || '/'
          || (v_student.batch_year + ceil(v_sem / 2.0)::int)::text;
  v_plan := public.student_minor_plan(v_student.id, v_sem, v_year);

  return jsonb_build_object(
    'department', v_student.department,
    'current_semester', v_sem,
    'chosen_minor', v_plan->'chosen_minor',
    'minors', v_plan->'minors',
    'note', case when jsonb_array_length(v_plan->'minors') = 0
      then 'This department has not published any minor streams.'
      else 'Each minor is the department''s study plan for Semesters 5 to 8. Each semester has baskets: '
        || 'a mandatory basket (every course in it must be taken; printed in red on the official plan) and an '
        || 'elective basket (take at least min_credits from its courses). The minor is claimed when every basket '
        || 'is met by passed courses and the passed credits reach required_credits. Course status: passed, '
        || 'enrolled (in that semester), failed or none. chosen_minor is the minor the student has said they are taking.'
      end);
end;
$function$;
