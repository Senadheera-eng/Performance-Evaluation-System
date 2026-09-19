-- create_course_offerings_and_backfill
-- Applied 20260808104409
-- Exported from the live project; do not edit by hand.

-- One delivery of a catalogue course to one batch in one academic year.
--
-- Lecturers are assigned to an offering, never to the catalogue row: the
-- same course is taught by different people in different years, and an
-- assignment recorded against `courses` would silently rewrite history every
-- time the teaching staff changed.
--
-- `department` is the OWNING department (courses.department), not the
-- students'. This is the same ownership rule the results, attendance and
-- medical policies already use, and it is what makes an Interdisciplinary
-- Studies course belong to IS even though every student on it is homed
-- elsewhere.

create table if not exists public.course_offerings (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses(id) on delete cascade,
  academic_year text not null,
  semester      integer not null,
  batch_year    integer not null,
  department    text not null,
  status        text not null default 'active' check (status in ('active', 'archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (course_id, academic_year, batch_year)
);

create index if not exists course_offerings_department_idx on public.course_offerings (department);
create index if not exists course_offerings_course_idx     on public.course_offerings (course_id);
create index if not exists course_offerings_scope_idx      on public.course_offerings (batch_year, semester);

-- Backfill from what the system already knows was delivered. Both sides are
-- needed: semesters 1-6 were bulk-imported straight into `results` and have
-- fewer enrollment rows than result rows, while semester 7 has enrollments
-- with no results yet. batch_year comes from the student, so a course taken
-- by repeat candidates from an earlier batch correctly yields one offering
-- per batch rather than merging them.
insert into public.course_offerings (course_id, academic_year, semester, batch_year, department)
select distinct c.id, r.academic_year, c.semester, s.batch_year, c.department
  from public.results r
  join public.courses  c on c.id = r.course_id
  join public.students s on s.id = r.student_id
 where s.batch_year is not null
on conflict (course_id, academic_year, batch_year) do nothing;

insert into public.course_offerings (course_id, academic_year, semester, batch_year, department)
select distinct c.id, e.academic_year, c.semester, s.batch_year, c.department
  from public.enrollments e
  join public.courses  c on c.id = e.course_id
  join public.students s on s.id = e.student_id
 where s.batch_year is not null
on conflict (course_id, academic_year, batch_year) do nothing;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.course_offerings enable row level security;

-- Readable by any signed-in user, exactly as `courses` already is: students
-- browse the catalogue to enrol, and an offering carries no more sensitive
-- information than the course row it points at.
drop policy if exists course_offerings_read on public.course_offerings;
create policy course_offerings_read on public.course_offerings
  for select to authenticated using (true);

drop policy if exists course_offerings_dept_admin_write on public.course_offerings;
create policy course_offerings_dept_admin_write on public.course_offerings
  for all to authenticated
  using      (get_my_role() = 'dept_admin' and get_my_department() = department)
  with check (get_my_role() = 'dept_admin' and get_my_department() = department);

drop policy if exists course_offerings_hod_write on public.course_offerings;
create policy course_offerings_hod_write on public.course_offerings
  for all to authenticated
  using      (is_active_hod_of(department))
  with check (is_active_hod_of(department));

drop policy if exists course_offerings_super_admin_write on public.course_offerings;
create policy course_offerings_super_admin_write on public.course_offerings
  for all to authenticated
  using      (get_my_role() = 'super_admin')
  with check (get_my_role() = 'super_admin');
