-- The faculty's own website (eng.sjp.ac.lk) as a second source for the AI
-- assistant, beside the handbook: departments, programmes, staff, news,
-- facilities, contacts — what the handbook's regulations do not cover.
--
-- The site is read ahead of time by the faculty-site-sync function, not
-- browsed while a student waits: answers stay fast, a slow or changed page
-- cannot break one, and nothing outside the faculty's own site is read.
--
-- faculty_site_pages is the crawl's memory — every page found, whether it
-- has been read, when, and a hash of its text so an unchanged page is not
-- rewritten. faculty_site_chunks is what is searched: each page's main text
-- in sections, with the page's address so an answer can link to it.

create table if not exists public.faculty_site_pages (
  url           text primary key,
  title         text,
  status        text not null default 'pending'
                check (status in ('pending', 'ok', 'skipped', 'error')),
  http_status   integer,
  content_hash  text,
  error         text,
  discovered_at timestamptz not null default now(),
  fetched_at    timestamptz,
  changed_at    timestamptz
);

create index if not exists faculty_site_pages_due
  on public.faculty_site_pages (status, fetched_at nulls first);

create table if not exists public.faculty_site_chunks (
  id          uuid primary key default gen_random_uuid(),
  url         text not null references public.faculty_site_pages (url) on delete cascade,
  title       text not null,
  section     text,
  chunk_index integer not null,
  content     text not null,
  -- Title outweighs section outweighs body: a page called "Department of
  -- Computer Engineering" should lead for that name even if the body of
  -- another page mentions it more often.
  tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(section, '')), 'B') ||
    setweight(to_tsvector('english', content), 'C')
  ) stored,
  created_at  timestamptz not null default now(),
  unique (url, chunk_index)
);

create index if not exists faculty_site_chunks_tsv
  on public.faculty_site_chunks using gin (tsv);

-- Written only by the sync function (service role). Read only through the
-- functions below.
alter table public.faculty_site_pages  enable row level security;
alter table public.faculty_site_chunks enable row level security;

/* Search, the same way the handbook is searched: the question's words are
   stemmed and OR'd rather than all required, so a natural sentence finds
   the page that answers it. At most two sections per page, so one long page
   cannot crowd out every other. */
create or replace function public.search_faculty_site(
  p_query text,
  p_limit integer default 4
)
returns table (url text, title text, section text, content text, score real)
language sql
stable
security definer
set search_path to 'public'
as $$
  with q as (
    select nullif(
             array_to_string(
               tsvector_to_array(to_tsvector('english', coalesce(p_query, ''))),
               ' | '
             ),
             ''
           ) as or_query
  ),
  ranked as (
    select c.url, c.title, c.section, c.content, c.chunk_index,
           ts_rank_cd(c.tsv, to_tsquery('simple', q.or_query)) as score
      from public.faculty_site_chunks c, q
     where q.or_query is not null
       and c.tsv @@ to_tsquery('simple', q.or_query)
  ),
  per_page as (
    select r.*, row_number() over (partition by r.url order by r.score desc, r.chunk_index) as n
      from ranked r
  )
  select p.url, p.title, p.section, p.content, p.score
    from per_page p
   where p.n <= 2
   order by p.score desc, p.url, p.chunk_index
   limit greatest(1, least(coalesce(p_limit, 4), 10))
$$;

/* For the Super Admin's dashboard: how much of the site the assistant
   knows, and how fresh it is. */
create or replace function public.get_faculty_site_status()
returns table (
  pages_known   integer,
  pages_read    integer,
  pages_pending integer,
  pages_failed  integer,
  sections      integer,
  last_read_at  timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.admins a
     where a.id = auth.uid() and a.role = 'super_admin'
  ) then
    raise exception 'Only the Super Admin can see the website sync.';
  end if;

  return query
  select (select count(*)::int from public.faculty_site_pages),
         (select count(*)::int from public.faculty_site_pages where status = 'ok'),
         (select count(*)::int from public.faculty_site_pages where status = 'pending'),
         (select count(*)::int from public.faculty_site_pages where status = 'error'),
         (select count(*)::int from public.faculty_site_chunks),
         (select max(fetched_at) from public.faculty_site_pages);
end;
$$;

revoke execute on function public.search_faculty_site(text, integer) from public, anon;
revoke execute on function public.get_faculty_site_status() from public, anon;
grant execute on function public.search_faculty_site(text, integer) to authenticated;
grant execute on function public.get_faculty_site_status() to authenticated;
