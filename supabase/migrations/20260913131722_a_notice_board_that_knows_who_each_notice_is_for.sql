/*
  The academic notice board.

  The proposal names the problem it solves directly: "Academic records,
  examination results, course details, and timetables are currently dispersed
  across multiple systems and communication channels. Results are often shared
  via notice boards or informal channels." This is the place those things land
  instead.

  Two decisions shape the schema, and both are borrowed rather than invented.

  Scope lives on the notice as nullable columns, not in a separate targets
  table. Null means "not narrowed by this", so department null is the whole
  faculty and batch null is every batch. enrollment_periods and
  feedback_periods already scope themselves exactly this way, so a reader who
  understands one understands all three, and the combination is indexable in a
  way a join table would not be.

  Visibility and relevance are different questions and are answered
  separately. A student may SEE anything aimed at their department and batch,
  including a notice from two years ago — that is what makes the archive worth
  having. What is RELEVANT to them today is narrower: their current semester,
  the courses they are enrolled in now, whatever is pinned. Collapsing the two
  would mean either hiding history or drowning the front page in it.
*/

/* ---------------------------------------------------------------- categories */

create table if not exists public.notice_categories (
  slug text primary key,
  label text not null,
  /* A lucide icon name. The client maps it to a component; an unknown name
     falls back rather than breaking the page, so adding a category here is
     safe without a deploy. */
  icon text not null default 'FileText',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  /* Some categories are only meaningful from certain desks. A lecturer has no
     business filing a faculty examination timetable. Null means anyone who
     may publish at all. */
  min_publisher text
    check (min_publisher in ('lecturer', 'hod', 'dept_admin', 'super_admin'))
);

comment on table public.notice_categories is
  'Configurable notice categories. Adding a row is enough to make a new '
  'category appear; the client falls back to a default icon for a name it '
  'does not know.';

insert into public.notice_categories (slug, label, icon, sort_order, min_publisher)
values
  ('exam_timetable',    'Examination Timetables', 'CalendarClock',  10, 'dept_admin'),
  ('lecture_timetable', 'Lecture Timetables',     'CalendarDays',   20, 'hod'),
  ('lab_schedule',      'Laboratory Schedules',   'FlaskConical',   30, 'lecturer'),
  ('results',           'Results',                'TrendingUp',     40, 'hod'),
  ('academic',          'Academic Notices',       'GraduationCap',  50, 'lecturer'),
  ('general',           'General Notices',        'Megaphone',      60, 'dept_admin'),
  ('enrolment',         'Enrolment',              'ClipboardList',  70, 'dept_admin'),
  ('examination',       'Medical / Examination',  'Stethoscope',    80, 'dept_admin'),
  ('document',          'Other Documents',        'FileText',       90, 'lecturer')
on conflict (slug) do nothing;

alter table public.notice_categories enable row level security;

drop policy if exists notice_categories_read on public.notice_categories;
create policy notice_categories_read on public.notice_categories
  for select to authenticated using (true);

drop policy if exists notice_categories_super_admin on public.notice_categories;
create policy notice_categories_super_admin on public.notice_categories
  for all to authenticated
  using (public.get_my_role() = 'super_admin')
  with check (public.get_my_role() = 'super_admin');


/* ---------------------------------------------------------------- notices */

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),

  title text not null check (length(btrim(title)) between 3 and 200),
  category text not null references public.notice_categories(slug),
  /* The notice itself. Short by design — anything long belongs in the
     attachment, which is what people actually came for. */
  body text check (body is null or length(body) <= 5000),

  /* Scope. Null means "not narrowed by this one". */
  department text,
  batch_year integer,
  semester integer check (semester is null or semester between 1 and 8),
  academic_year text,
  /* Course-scoped notices name the offering, not the course: that is what
     tells us which cohort sat it and which lecturer may publish it. */
  offering_id uuid references public.course_offerings(id) on delete cascade,

  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  is_pinned boolean not null default false,

  published_at timestamptz,
  expires_at timestamptz,

  created_by uuid not null references auth.users(id) on delete cascade,
  /* Recorded at publication rather than looked up later: the person who filed
     it may lose the appointment they filed it under, and the notice should
     still say who it came from and in what capacity. */
  created_by_name text not null,
  created_by_role text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /* A published notice has a publication date. Nothing else makes sense, and
     "published with no date" is what would silently break every ordering. */
  constraint notices_published_has_date
    check (status <> 'published' or published_at is not null),
  constraint notices_expiry_after_publication
    check (expires_at is null or published_at is null or expires_at > published_at)
);

comment on table public.notices is
  'Academic notice board. Scope columns are nullable and mean "not narrowed '
  'by this": department null is faculty-wide. Visibility (may I see it) is a '
  'separate question from relevance (is it for me now) — see '
  'notice_visible_to_me and get_my_notices.';

/* The feed, as students actually read it: newest published first, pinned
   above. Partial because drafts and archived rows are never in that list. */
create index if not exists notices_feed_idx
  on public.notices (published_at desc)
  where status = 'published';

create index if not exists notices_scope_idx
  on public.notices (department, batch_year, semester);
create index if not exists notices_category_idx on public.notices (category);
create index if not exists notices_offering_idx on public.notices (offering_id)
  where offering_id is not null;
create index if not exists notices_author_idx on public.notices (created_by);
create index if not exists notices_expiry_idx on public.notices (expires_at)
  where expires_at is not null;

/* Search. A GIN index over the title and body, weighted so a word in the
   title outranks the same word buried in a paragraph. */
create index if not exists notices_search_idx on public.notices
  using gin (
    (setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
     setweight(to_tsvector('english', coalesce(body, '')), 'B'))
  );


create or replace function public.notices_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notices_updated_at on public.notices;
create trigger notices_updated_at before update on public.notices
  for each row execute function public.notices_touch_updated_at();


/* ---------------------------------------------------------------- attachments */

create table if not exists public.notice_attachments (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.notices(id) on delete cascade,
  /* Storage key inside the notice-attachments bucket, always led by the
     notice id — that is what the storage policy checks. */
  path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  sort_order integer not null default 0,
  uploaded_at timestamptz not null default now()
);

create index if not exists notice_attachments_notice_idx
  on public.notice_attachments (notice_id, sort_order);