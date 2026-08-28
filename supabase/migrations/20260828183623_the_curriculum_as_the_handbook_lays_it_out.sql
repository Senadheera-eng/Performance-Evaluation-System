-- the_curriculum_as_the_handbook_lays_it_out
-- Applied 20260828183623
-- Exported from the live project; do not edit by hand.

-- The shape of a semester, as the Faculty Handbook prints it.
--
-- The system knew which courses exist and which semester they belong to. It
-- did not know the thing the handbook's tables are actually about: that a
-- semester is a set of baskets, and a student satisfies each one rather than
-- taking everything in it. Semester 7 for Computer Engineering is four
-- compulsory courses, then "Elective (2)" -- pick two credits from Data
-- Management Project or High Performance Computing Project -- then
-- "Elective (3)" from four courses, then "Elective (1)" from the language and
-- humanities set. Without that, enrolment could only offer a flat list and
-- leave the student to work out the rules from a PDF.
--
-- The basket label is stored exactly as printed, because it is what the
-- student will be shown and what they can check against the handbook.
-- required_credits is the number inside it. Some labels carry two, like
-- "Elective (1/0)" and "Elective (8/7)", where the requirement differs by
-- stream; the first is taken as the requirement and the label keeps the rest
-- visible rather than the system inventing a rule the handbook does not state.

create table if not exists public.curriculum_slots (
  id                 uuid primary key default gen_random_uuid(),
  -- 'COMMON' for semesters 1 and 2, which the whole faculty shares.
  department         text    not null,
  semester           integer not null check (semester between 1 and 8),
  course_id          uuid    not null references public.courses(id) on delete cascade,
  basket             text    not null,
  required_credits   integer,
  -- As printed in the handbook, kept so the catalogue can be checked against
  -- it rather than the two silently disagreeing.
  handbook_gpa       boolean,
  created_at         timestamptz not null default now(),
  unique (department, semester, course_id)
);

create index if not exists curriculum_slots_lookup
  on public.curriculum_slots (department, semester);

alter table public.curriculum_slots enable row level security;

-- The curriculum is public knowledge inside the faculty: a student needs it to
-- choose, and it is printed in a handbook everyone has.
drop policy if exists curriculum_slots_read on public.curriculum_slots;
create policy curriculum_slots_read on public.curriculum_slots
  for select to authenticated using (true);

drop policy if exists curriculum_slots_admin_write on public.curriculum_slots;
create policy curriculum_slots_admin_write on public.curriculum_slots
  for all to authenticated
  using (get_my_role() = 'super_admin'
         or (get_my_role() = 'dept_admin' and get_my_department() = department)
         or public.is_active_hod_of(department))
  with check (get_my_role() = 'super_admin'
         or (get_my_role() = 'dept_admin' and get_my_department() = department)
         or public.is_active_hod_of(department));

-- How much a minor is worth, and therefore when a student has finished one.
-- The minor itself already exists on courses.minor_category; what was missing
-- was the total it takes to claim one.
create table if not exists public.minor_requirements (
  department       text    not null,
  minor            text    not null,
  required_credits integer not null check (required_credits > 0),
  primary key (department, minor)
);

alter table public.minor_requirements enable row level security;

drop policy if exists minor_requirements_read on public.minor_requirements;
create policy minor_requirements_read on public.minor_requirements
  for select to authenticated using (true);

drop policy if exists minor_requirements_admin_write on public.minor_requirements;
create policy minor_requirements_admin_write on public.minor_requirements
  for all to authenticated
  using (get_my_role() = 'super_admin'
         or (get_my_role() = 'dept_admin' and get_my_department() = department)
         or public.is_active_hod_of(department))
  with check (get_my_role() = 'super_admin'
         or (get_my_role() = 'dept_admin' and get_my_department() = department)
         or public.is_active_hod_of(department));
