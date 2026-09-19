/*
  The documents, and the query that puts them in front of the right person.
*/

/* ---------------------------------------------------------------- storage */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notice-attachments', 'notice-attachments', false,
  20971520,  -- 20 MB: a scanned examination timetable is bigger than a memo
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
  The key is led by the notice id, exactly as mentor attachments are led by
  the assignment id, because that is the one thing the policy can check
  without trusting anything the client said about the file.

  Private bucket and no public URL anywhere: a reader gets a short-lived
  signed link only after the same visibility rule that guards the row has
  said yes.
*/
drop policy if exists notice_attachments_object_read on storage.objects;
create policy notice_attachments_object_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'notice-attachments'
    and public.notice_visible_to_me(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists notice_attachments_object_write on storage.objects;
create policy notice_attachments_object_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'notice-attachments'
    and public.can_edit_notice(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists notice_attachments_object_delete on storage.objects;
create policy notice_attachments_object_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'notice-attachments'
    and public.can_edit_notice(((storage.foldername(name))[1])::uuid)
  );


/* ---------------------------------------------------------------- the feed */

/**
 * The notice board, from where the caller is standing.
 *
 * One query does the filtering, the searching, the relevance scoring and the
 * paging, because doing any of it in React would mean shipping every notice
 * in the faculty to every browser and then hiding most of it — which is both
 * slow and not a security boundary.
 *
 * `relevance` is what separates "For You" from "All Notices". It is not a
 * filter: a student can still reach everything they are allowed to see. It
 * only decides what comes first.
 */
create or replace function public.get_my_notices(
  p_scope text default 'all',          -- 'all' | 'for_me'
  p_category text default null,
  p_department text default null,
  p_batch_year integer default null,
  p_semester integer default null,
  p_academic_year text default null,
  p_pinned_only boolean default false,
  p_include_expired boolean default false,
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
  id uuid,
  title text,
  category text,
  category_label text,
  category_icon text,
  body text,
  department text,
  batch_year integer,
  semester integer,
  academic_year text,
  offering_id uuid,
  course_code text,
  course_title text,
  status text,
  is_pinned boolean,
  published_at timestamptz,
  expires_at timestamptz,
  is_expired boolean,
  created_by_name text,
  created_by_role text,
  attachment_count integer,
  relevance integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_student   record;
  v_now       timestamptz := now();
  v_semester  integer;
  v_query     tsquery;
begin
  select s.department, s.batch_year into v_student
    from public.students s where s.id = auth.uid() and s.role = 'student';

  if found and v_student.batch_year is not null then
    v_semester := public.current_semester_for_batch(v_student.batch_year);
  end if;

  /* websearch_to_tsquery rather than plainto_: it understands quoted
     phrases and OR, which is what someone typing into a search box on a
     notice board expects. */
  if p_search is not null and btrim(p_search) <> '' then
    v_query := websearch_to_tsquery('english', p_search);
  end if;

  return query
  with visible as (
    select n.*
      from public.notices n
     where n.status = 'published'
       and n.published_at <= v_now
       and public.notice_visible_to_me(n.id)
  ),
  scored as (
    select v.*,
           (v.expires_at is not null and v.expires_at <= v_now) as expired,
           /* Relevance, highest first. Pinned wins outright; after that,
              something aimed squarely at this student beats something
              merely allowed to reach them. */
           (case when v.is_pinned then 100 else 0 end)
         + (case when v.offering_id is not null then 40 else 0 end)
         + (case when v_semester is not null and v.semester = v_semester
                 then 30 else 0 end)
         + (case when v.batch_year is not null then 15 else 0 end)
         + (case when v.department is not null then 10 else 0 end)
         + (case when v.published_at > v_now - interval '14 days'
                 then 5 else 0 end) as score
      from visible v
  ),
  filtered as (
    select s.*
      from scored s
     where (p_category is null or s.category = p_category)
       and (p_department is null or s.department = p_department)
       and (p_batch_year is null or s.batch_year = p_batch_year)
       and (p_semester is null or s.semester = p_semester)
       and (p_academic_year is null or s.academic_year = p_academic_year)
       and (not p_pinned_only or s.is_pinned)
       and (p_include_expired or not s.expired)
       /* "For you" keeps what is actually aimed at this student: their
          semester, a course they are on, or something faculty-wide and
          pinned. Everything else is still one tab away. */
       and (p_scope <> 'for_me'
            or s.is_pinned
            or s.offering_id is not null
            or (v_semester is not null and s.semester = v_semester)
            or (s.semester is null and s.batch_year is not null)
            or (s.semester is null and s.batch_year is null
                and s.published_at > v_now - interval '60 days'))
       and (v_query is null
            or (setweight(to_tsvector('english', coalesce(s.title, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(s.body, '')), 'B'))
                @@ v_query
            or s.title ilike '%' || p_search || '%'
            or exists (select 1 from public.course_offerings o
                        join public.courses c on c.id = o.course_id
                       where o.id = s.offering_id
                         and (c.course_code ilike '%' || p_search || '%'
                           or c.title ilike '%' || p_search || '%')))
  )
  select f.id, f.title, f.category, cat.label, cat.icon, f.body,
         f.department, f.batch_year, f.semester, f.academic_year,
         f.offering_id, c.course_code, c.title,
         f.status, f.is_pinned, f.published_at, f.expires_at, f.expired,
         f.created_by_name, f.created_by_role,
         (select count(*)::int from public.notice_attachments a
           where a.notice_id = f.id),
         f.score,
         count(*) over () as total_count
    from filtered f
    join public.notice_categories cat on cat.slug = f.category
    left join public.course_offerings o on o.id = f.offering_id
    left join public.courses c on c.id = o.course_id
   order by f.is_pinned desc, f.score desc, f.published_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

grant execute on function public.get_my_notices(
  text, text, text, integer, integer, text, boolean, boolean, text, integer, integer
) to authenticated;


/* ---------------------------------------------------------------- telling people */

/*
  Publication is the event worth hearing about, and it reuses the machinery
  built for every other one — same table, same bell, same realtime socket.
  Nothing here is a second notification system.
*/
alter table public.notifications drop constraint if exists notifications_source_check;
alter table public.notifications add constraint notifications_source_check
  check (source in (
    'results', 'attendance', 'enrolment', 'feedback',
    'medical', 'mentoring', 'teaching', 'notices'
  ));

create or replace function public.notify_notice_published()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_recipients uuid[];
begin
  for r in
    select n.* from new_rows n
      join old_rows o on o.id = n.id
     where n.status = 'published'
       and o.status is distinct from 'published'
  loop
    if r.offering_id is not null then
      v_recipients := public.offering_student_ids(r.offering_id);
    else
      select coalesce(array_agg(s.id), '{}'::uuid[]) into v_recipients
        from public.students s
       where s.role = 'student'
         and s.status = 'active'
         and (r.department is null or s.department = r.department)
         and (r.batch_year is null or s.batch_year = r.batch_year);
    end if;

    perform public.notify_users(
      v_recipients, 'notices', 'notice_published',
      (select label from public.notice_categories where slug = r.category)
        || ': ' || r.title,
      coalesce(nullif(btrim(r.body), ''),
               'Published by ' || r.created_by_name || '.'),
      '/app/notices/' || r.id, 'notice', r.id);
  end loop;
  return null;
end;
$$;

drop trigger if exists notices_notify_published on public.notices;
create trigger notices_notify_published
  after update on public.notices
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.notify_notice_published();

/* A notice created already published — the common case, since most people
   write and post in one go — never passes through an UPDATE. */
create or replace function public.notify_notice_created_published()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_recipients uuid[];
begin
  for r in select n.* from new_rows n where n.status = 'published'
  loop
    if r.offering_id is not null then
      v_recipients := public.offering_student_ids(r.offering_id);
    else
      select coalesce(array_agg(s.id), '{}'::uuid[]) into v_recipients
        from public.students s
       where s.role = 'student'
         and s.status = 'active'
         and (r.department is null or s.department = r.department)
         and (r.batch_year is null or s.batch_year = r.batch_year);
    end if;

    perform public.notify_users(
      v_recipients, 'notices', 'notice_published',
      (select label from public.notice_categories where slug = r.category)
        || ': ' || r.title,
      coalesce(nullif(btrim(r.body), ''),
               'Published by ' || r.created_by_name || '.'),
      '/app/notices/' || r.id, 'notice', r.id);
  end loop;
  return null;
end;
$$;

drop trigger if exists notices_notify_created on public.notices;
create trigger notices_notify_created
  after insert on public.notices
  referencing new table as new_rows
  for each statement execute function public.notify_notice_created_published();