-- extend_lecturers_and_seed_from_handbook
-- Applied 20260808104242
-- Exported from the live project; do not edit by hand.

-- Academic staff identity.
--
-- `lecturers` already existed but held six placeholder rows. Rather than
-- introducing a parallel `staff` table, this extends the table that is
-- already wired into the schema (feedback.lecturer_id, course_lecturers)
-- so there is exactly one academic-staff identity, not two.
--
-- auth_user_id is nullable on purpose: a lecturer record is faculty data and
-- exists whether or not a login has been provisioned for that person yet.

alter table public.lecturers
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists title text,
  add column if not exists staff_no text,
  add column if not exists status text not null default 'active',
  add column if not exists updated_at timestamptz not null default now();

alter table public.lecturers drop constraint if exists lecturers_status_check;
alter table public.lecturers
  add constraint lecturers_status_check check (status in ('active', 'inactive'));

-- One placeholder row carried 'Electrical Engineering', which matches
-- nothing in system_settings.student_departments and so could never join to
-- a course or satisfy a department-scoped policy.
update public.lecturers
   set department = 'Electrical and Electronic Engineering'
 where department = 'Electrical Engineering';

-- Verified academic staff, Faculty Handbook 2026, listed department by
-- department with the official addresses printed alongside each entry.
-- Upserted on email so the existing rows keep their ids (and any rows that
-- later gain an auth_user_id keep their login).
insert into public.lecturers (name, email, department, title, status) values
  -- Department of Civil Engineering
  ('Praween Madusanka',    'praweenmadusanka@sjp.ac.lk',    'Civil Engineering', 'Dr.',   'active'),
  ('Chaminda Konthesingha','konthesingha@sjp.ac.lk',        'Civil Engineering', 'Prof.', 'active'),
  ('Ganga Samarasekara',   'gangas@sjp.ac.lk',              'Civil Engineering', 'Prof.', 'active'),
  ('Nilan Weerakoon',      'weerakoon@sjp.ac.lk',           'Civil Engineering', 'Dr.',   'active'),
  ('Irindu Upasiri',       'irinduupasiri@sjp.ac.lk',       'Civil Engineering', 'Dr.',   'active'),
  ('Wasantha Kumara',      'pmwpkumara@sjp.ac.lk',          'Civil Engineering', 'Mr.',   'active'),
  ('Avishka Siriwardana',  'avishkasiriwardana@sjp.ac.lk',  'Civil Engineering', 'Mr.',   'active'),
  ('Dilini Dissanayake',   'dilinidissanayake@sjp.ac.lk',   'Civil Engineering', 'Ms.',   'active'),
  ('Kobika Mathushan',     'kobithaya@sjp.ac.lk',           'Civil Engineering', 'Mrs.',  'active'),
  ('Chathura Amarasinghe', 'chathuraamarasinghe@sjp.ac.lk', 'Civil Engineering', 'Mr.',   'active'),

  -- Department of Computer Engineering
  ('Udaya Wijenayake',      'udayaw@sjp.ac.lk',                 'Computer Engineering', 'Dr.', 'active'),
  ('Randima Dinalankara',   'randima@sjp.ac.lk',                'Computer Engineering', 'Dr.', 'active'),
  ('Krishanthmohan Ratnam', 'rkmohan@sjp.ac.lk',                'Computer Engineering', 'Dr.', 'active'),
  ('Dilani Ranaweera',      'dilani.ranaweera@sjp.ac.lk',       'Computer Engineering', 'Ms.', 'active'),
  ('Ishara Dissanayake',    'isharadissanayake@sjp.ac.lk',      'Computer Engineering', 'Mr.', 'active'),
  ('Akarshani Amarasinghe', 'akarshani.amarasinghe@sjp.ac.lk',  'Computer Engineering', 'Ms.', 'active'),
  ('Lakshan Madhushanka',   'lakshan@sjp.ac.lk',                'Computer Engineering', 'Mr.', 'active'),
  ('Sanuri Liyanaarachchi', 'sanurihimalka@sjp.ac.lk',          'Computer Engineering', 'Ms.', 'active'),

  -- Department of Electrical and Electronic Engineering
  ('Uditha Wijewardhana', 'uditha@sjp.ac.lk',              'Electrical and Electronic Engineering', 'Dr.', 'active'),
  ('Nishan Dharmaweera',  'nishanmd@sjp.ac.lk',            'Electrical and Electronic Engineering', 'Dr.', 'active'),
  ('Charithri Yapa',      'charithriyapa@sjp.ac.lk',       'Electrical and Electronic Engineering', 'Dr.', 'active'),
  ('Pasan Maduranga',     'pasanm@sjp.ac.lk',              'Electrical and Electronic Engineering', 'Dr.', 'active'),
  ('Nimantha Madhushan',  'nimanthamk@sjp.ac.lk',          'Electrical and Electronic Engineering', 'Mr.', 'active'),
  ('Umaya Balagalla',     'umayabalagalla@sjp.ac.lk',      'Electrical and Electronic Engineering', 'Ms.', 'active'),
  ('Narmada Ranaweera',   'narmadaranaweera@sjp.ac.lk',    'Electrical and Electronic Engineering', 'Ms.', 'active'),
  ('Dhanushika Darshani', 'dhanushikadarshani@sjp.ac.lk',  'Electrical and Electronic Engineering', 'Ms.', 'active'),

  -- Department of Mechanical Engineering
  ('Darshana Makavita',      'makavita@sjp.ac.lk',              'Mechanical Engineering', 'Dr.', 'active'),
  ('Dulini Mudunkotuwa',     'dulini@sjp.ac.lk',                'Mechanical Engineering', 'Dr.', 'active'),
  ('Geethal Siriwardana',    'geethal@sjp.ac.lk',               'Mechanical Engineering', 'Dr.', 'active'),
  ('Yasun Sampath',          'yasun@sjp.ac.lk',                 'Mechanical Engineering', 'Mr.', 'active'),
  ('Sayuru Bandara',         'sayurudilan@sjp.ac.lk',           'Mechanical Engineering', 'Mr.', 'active'),
  ('Anjan Rajapakse',        'anjanrajapakse@sjp.ac.lk',        'Mechanical Engineering', 'Mr.', 'active'),
  ('Nilani Pathinayake',     'pathinayakenilani@sjp.ac.lk',     'Mechanical Engineering', 'Ms.', 'active'),
  ('Kasun Sooriyapperuma',   'kasunchanuka@sjp.ac.lk',          'Mechanical Engineering', 'Mr.', 'active'),
  ('Uvindu Thilakarathne',   'uvinduthilakarathne@sjp.ac.lk',   'Mechanical Engineering', 'Mr.', 'active'),

  -- Department of Interdisciplinary Studies
  -- Dr. Nadika Jayasooriya is printed with a personal address in the
  -- handbook, not an sjp.ac.lk one. Seeded verbatim; flagged for correction
  -- before a login is provisioned.
  ('Shyam Kularathna',     'shyamkularathna@sjp.ac.lk',  'Interdisciplinary Studies', 'Dr.', 'active'),
  ('Nadika Jayasooriya',   'nadikakeshan@gmail.com',     'Interdisciplinary Studies', 'Dr.', 'active'),
  ('Gayantha Kodagoda',    'gmkodagoda@sjp.ac.lk',       'Interdisciplinary Studies', 'Mr.', 'active'),
  ('Sajini Wickramasinghe','sajinitharika@sjp.ac.lk',    'Interdisciplinary Studies', 'Ms.', 'active'),
  ('Manoj Samarakoon',     'smmhsamarakoon@sjp.ac.lk',   'Interdisciplinary Studies', 'Mr.', 'active')
on conflict (email) do update set
  name       = excluded.name,
  department = excluded.department,
  title      = excluded.title,
  status     = 'active',
  updated_at = now();

-- Placeholder rows that are not faculty academic staff (e.g. the
-- Vice-Chancellor, seeded as a Computer Engineering lecturer) are retired
-- rather than deleted, so nothing that already references them breaks.
update public.lecturers
   set status = 'inactive', updated_at = now()
 where email not in (
   'praweenmadusanka@sjp.ac.lk','konthesingha@sjp.ac.lk','gangas@sjp.ac.lk',
   'weerakoon@sjp.ac.lk','irinduupasiri@sjp.ac.lk','pmwpkumara@sjp.ac.lk',
   'avishkasiriwardana@sjp.ac.lk','dilinidissanayake@sjp.ac.lk','kobithaya@sjp.ac.lk',
   'chathuraamarasinghe@sjp.ac.lk','udayaw@sjp.ac.lk','randima@sjp.ac.lk',
   'rkmohan@sjp.ac.lk','dilani.ranaweera@sjp.ac.lk','isharadissanayake@sjp.ac.lk',
   'akarshani.amarasinghe@sjp.ac.lk','lakshan@sjp.ac.lk','sanurihimalka@sjp.ac.lk',
   'uditha@sjp.ac.lk','nishanmd@sjp.ac.lk','charithriyapa@sjp.ac.lk','pasanm@sjp.ac.lk',
   'nimanthamk@sjp.ac.lk','umayabalagalla@sjp.ac.lk','narmadaranaweera@sjp.ac.lk',
   'dhanushikadarshani@sjp.ac.lk','makavita@sjp.ac.lk','dulini@sjp.ac.lk',
   'geethal@sjp.ac.lk','yasun@sjp.ac.lk','sayurudilan@sjp.ac.lk',
   'anjanrajapakse@sjp.ac.lk','pathinayakenilani@sjp.ac.lk','kasunchanuka@sjp.ac.lk',
   'uvinduthilakarathne@sjp.ac.lk','shyamkularathna@sjp.ac.lk','nadikakeshan@gmail.com',
   'gmkodagoda@sjp.ac.lk','sajinitharika@sjp.ac.lk','smmhsamarakoon@sjp.ac.lk'
 );

create index if not exists lecturers_department_idx on public.lecturers (department) where status = 'active';
create index if not exists lecturers_auth_user_idx on public.lecturers (auth_user_id);
