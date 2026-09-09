-- A failed course has to be repeatable.
--
-- The Handbook is explicit: F means "Failed and Repeat Course", and a student
-- who has one "has to follow the Course in full". The enrolment path only
-- ever looked for R and L, so twenty students holding thirty-two F grades had
-- no way to enrol in the course they were required to repeat. The grade was
-- recorded and then led nowhere.
--
-- F joins R and L as a reason to be offered a course again. It is its own
-- kind rather than borrowed from R, because the two are different obligations
-- and a student should be told which one they are under: an R re-sits the
-- end-of-semester exam with the CA mark carried forward, while an F follows
-- the whole course again, CA included.
--
-- The cap follows the same reading. "Student re-sitting ESE or repeating a
-- course cannot secure a grade greater than C" covers both, so a repeat of an
-- F is capped exactly as a re-sit of an R already was. L stays uncapped: an
-- Academic Concession is a postponement, not a failure, and the student
-- resumes on normal terms.

alter table public.enrollments drop constraint if exists enrollments_kind_check;
alter table public.enrollments add constraint enrollments_kind_check
  check (enrollment_kind = any (array['regular', 'repeat_r', 'repeat_l', 'repeat_f']));

create or replace function public.enrolment_kind_for_course(p_course_id uuid)
returns text
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_student record;
  v_grade   text;
begin
  select s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student is null then return null; end if;

  -- Route 1 -- the window for the semester this student's batch is in now.
  if exists (
    select 1 from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
       and p.semester = public.current_semester_for_batch(v_student.batch_year)
       and public.period_covers_course(p.id, p_course_id)
  ) then
    return 'regular';
  end if;

  -- Route 2 -- a module still owed, carried by any open window. The window
  -- naming the course is the offer; the student's own batch does not enter
  -- into it, which is the whole point of sitting with a later batch.
  select r.grade into v_grade
    from public.results r
   where r.student_id = auth.uid()
     and r.course_id = p_course_id
     and r.is_published
     and r.grade in ('R', 'L', 'F');
  if v_grade is null then return null; end if;

  if exists (
    select 1 from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
       and public.period_covers_course(p.id, p_course_id)
  ) then
    return case v_grade
             when 'R' then 'repeat_r'
             when 'L' then 'repeat_l'
             else 'repeat_f'
           end;
  end if;

  return null;
end;
$$;

grant execute on function public.enrolment_kind_for_course(uuid) to authenticated;

create or replace function public.get_my_enrolment_options()
returns table(
  course_id uuid, course_code text, title text, credits integer, semester integer,
  category text, department text, kind text, outstanding_from text,
  period_id uuid, period_title text, period_batch integer, period_semester integer,
  period_academic_year text, closes_at timestamp with time zone, capacity integer,
  enrolled_count integer, already_enrolled boolean, locked boolean)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_student record;
  v_current integer;
begin
  select s.id, s.batch_year, s.department into v_student
    from public.students s where s.id = auth.uid();
  if v_student is null then return; end if;

  v_current := public.current_semester_for_batch(v_student.batch_year);

  return query
  with windows as (
    select p.* from public.enrollment_periods p
     where p.status = 'open'
       and now() between p.opens_at and p.closes_at
       and (p.department is null or p.department = v_student.department)
  ),
  offered as (
    select w.id as period_id, w.title as period_title, w.batch_year as period_batch,
           w.semester as period_semester, w.academic_year as period_academic_year,
           w.closes_at, c.id as course_id, pc.capacity
      from windows w
      join public.courses c on public.period_covers_course(w.id, c.id)
      left join public.enrollment_period_courses pc
        on pc.period_id = w.id and pc.course_id = c.id
  ),
  eligible as (
    select o.*,
           case
             when o.period_semester = v_current then 'regular'
             when r.grade = 'R' then 'repeat_r'
             when r.grade = 'L' then 'repeat_l'
             when r.grade = 'F' then 'repeat_f'
           end as kind,
           r.grade as outstanding_from
      from offered o
      left join public.results r
        on r.student_id = v_student.id and r.course_id = o.course_id
       and r.is_published and r.grade in ('R', 'L', 'F')
  )
  select c.id, c.course_code, c.title, c.credits, c.semester, c.category, c.department,
         e.kind, e.outstanding_from,
         e.period_id, e.period_title, e.period_batch, e.period_semester,
         e.period_academic_year, e.closes_at, e.capacity,
         (select count(*)::int from public.enrollments en
           where en.course_id = c.id
             and en.academic_year = e.period_academic_year
             and en.status = 'enrolled'),
         exists (select 1 from public.enrollments en
                  where en.student_id = v_student.id and en.course_id = c.id
                    and en.academic_year = e.period_academic_year),
         -- A repeat sat under an earlier grade always has a result row, so the
         -- lock has to mean a mark for the attempt being enrolled in now.
         exists (select 1 from public.results r2
                  where r2.student_id = v_student.id and r2.course_id = c.id
                    and r2.academic_year = e.period_academic_year)
    from eligible e
    join public.courses c on c.id = e.course_id
   where e.kind is not null
     -- A module owed is owed wherever it is taught, so a repeat is never
     -- filtered by department. The semester's own intake is: a student reads
     -- their own department's courses plus the shared ones.
     and (e.kind <> 'regular'
          or c.department = v_student.department
          or c.department = 'Interdisciplinary Studies')
   order by e.kind, c.semester, c.course_code;
end;
$$;

grant execute on function public.get_my_enrolment_options() to authenticated;

-- The cap now recognises a repeat of an F as capped, and still leaves a
-- medical concession alone.
create or replace function public.cap_resit_grade()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_origin   text;
  v_cap      text;
  v_cap_gpv  numeric;
begin
  -- An authorised correction says this was never a repeat.
  if coalesce(current_setting('pes.grade_correction', true), '') = 'on' then
    return new;
  end if;

  v_origin := coalesce(new.original_grade, old.original_grade);
  if old.grade in ('R', 'L', 'F')
     and new.grade is not null and new.grade not in ('R', 'L', 'F') then
    v_origin := coalesce(v_origin, old.grade);
  end if;

  new.original_grade := v_origin;

  -- R and F both cap; L does not.
  if v_origin in ('R', 'F')
     and new.grade is not null and new.grade not in ('R', 'L', 'F') then
    select value #>> '{}' into v_cap
      from public.system_settings where key = 'resit_max_grade';
    v_cap := coalesce(v_cap, 'C');

    select (value -> v_cap)::numeric into v_cap_gpv
      from public.system_settings where key = 'gpv_scale';

    if v_cap_gpv is not null and coalesce(new.gpv, 0) > v_cap_gpv then
      new.grade := v_cap;
      new.gpv   := v_cap_gpv;
    end if;
  end if;

  return new;
end;
$$;
