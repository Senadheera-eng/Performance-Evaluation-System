-- a_window_offers_what_the_semester_curriculum_contains
-- Applied 20260829044717
-- Exported from the live project; do not edit by hand.

-- A window offers what the semester's curriculum contains.
--
-- Asked which courses a window carries, this fell back to "every course whose
-- own semester matches the window's". But a course's semester is where it
-- lives in the catalogue, not the only place a curriculum may call on it.
-- Every department's Semester 7 includes the Elective (1) language and
-- general-studies courses, which sit at Semester 5 in the catalogue -- so a
-- Semester 7 window carried 43 of the 47 courses that Semester 7 curricula
-- actually need, and a student who ticked one of the missing four was told
-- on Save that enrolment was not open for it.
--
-- The curriculum is the authority on what a semester contains. The fallback
-- now asks it as well: a course is carried if its own semester matches, or
-- if any department's curriculum places it in that semester. Additive -- no
-- course that was covered before loses coverage.
--
-- An explicit course list still wins outright where a department has set one.
-- That is the point of setting one: this round carries these and nothing
-- else.

create or replace function public.period_covers_course(
  p_period_id uuid, p_course_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select case
    -- A department that named its courses meant exactly those.
    when exists (select 1 from public.enrollment_period_courses pc
                  where pc.period_id = p_period_id)
      then exists (select 1 from public.enrollment_period_courses pc
                    where pc.period_id = p_period_id
                      and pc.course_id = p_course_id)
    -- Otherwise: the semester's own courses, plus whatever any department's
    -- curriculum places in that semester.
    else exists (
      select 1 from public.enrollment_periods p
       where p.id = p_period_id
         and (exists (select 1 from public.courses c
                       where c.id = p_course_id and c.semester = p.semester)
           or exists (select 1 from public.curriculum_slots s
                       where s.course_id = p_course_id
                         and s.semester = p.semester)))
  end;
$$;

comment on function public.period_covers_course(uuid, uuid) is
  'Whether an enrolment window carries a course: its explicit course list if it has one, otherwise the semester''s own courses plus anything a curriculum places in that semester.';
