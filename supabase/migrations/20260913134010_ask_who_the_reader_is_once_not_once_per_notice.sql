/*
  The feed asked "may I see this?" once per notice, and that question is
  expensive: notice_visible_to_me re-reads the notice, then get_my_role,
  my_hod_department, my_lecturer_id and the student row, every time. At two
  thousand notices the page stopped answering altogether.

  None of those facts change between one row and the next. The reader is the
  same reader all the way down the list. So they are resolved once, at the
  top, and the scope test becomes ordinary SQL in the WHERE clause that the
  planner can use an index for — instead of a function the planner has to
  call two thousand times and cannot see into.

  notice_visible_to_me stays exactly as it is, and stays the authority: the
  row policy and the storage policy both call it for a single row, which is
  what it is good at. What changed is that the list no longer asks it two
  thousand separate questions to build one page. The two must agree, and the
  test below checks that they do rather than trusting that they will.
*/

create or replace function public.get_my_notices(
  p_scope text default 'all',
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
  v_now        timestamptz := now();
  v_uid        uuid := auth.uid();
  v_role       text := coalesce(public.get_my_role(), '');
  v_hod        text := public.my_hod_department();
  v_lecturer   uuid := public.my_lecturer_id();
  v_staff_dept text;
  v_dept       text;
  v_batch      integer;
  v_semester   integer;
  v_is_student boolean := false;
  /* The offerings this reader may see course notices for. Gathered once;
     it is the only per-row question that needs a table. */
  v_offerings  uuid[] := '{}';
  v_query      tsquery;
begin
  select s.department, s.batch_year into v_dept, v_batch
    from public.students s where s.id = v_uid and s.role = 'student';
  v_is_student := found;

  if v_is_student then
    if v_batch is not null then
      v_semester := public.current_semester_for_batch(v_batch);
    end if;
    select coalesce(array_agg(distinct o.id), '{}'::uuid[]) into v_offerings
      from public.course_offerings o
      join public.enrollments e
        on e.course_id = o.course_id and e.academic_year = o.academic_year
     where e.student_id = v_uid;
  elsif v_lecturer is not null then
    select l.department into v_staff_dept
      from public.lecturers l where l.id = v_lecturer;
    select coalesce(array_agg(cl.offering_id), '{}'::uuid[]) into v_offerings
      from public.course_lecturers cl
     where cl.lecturer_id = v_lecturer and cl.is_active;
  end if;

  if p_search is not null and btrim(p_search) <> '' then
    v_query := websearch_to_tsquery('english', p_search);
  end if;

  return query
  with visible as (
    select n.*
      from public.notices n
     where n.status = 'published'
       and n.published_at <= v_now
       and (
         /* Same rule as notice_visible_to_me, written as a predicate the
            planner can work with rather than a call it cannot. */
         v_role = 'super_admin'
         or n.created_by = v_uid
         or (v_role = 'dept_admin' and (
               n.department is null
               or n.department = public.get_my_department()
               or n.offering_id = any(v_offerings)))
         or (v_hod is not null and (
               n.department is null
               or n.department = v_hod
               or n.offering_id = any(v_offerings)))
         or (v_lecturer is not null and v_hod is null and (
               n.department is null
               or n.department = v_staff_dept
               or n.offering_id = any(v_offerings)))
         or (v_is_student and (
               case
                 when n.offering_id is not null
                   then n.offering_id = any(v_offerings)
                 else (n.department is null or n.department = v_dept)
                  and (n.batch_year is null or n.batch_year = v_batch)
               end))
       )
  ),
  scored as (
    select v.*,
           (v.expires_at is not null and v.expires_at <= v_now) as expired,
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
    select s.* from scored s
     where (p_category is null or s.category = p_category)
       and (p_department is null or s.department = p_department)
       and (p_batch_year is null or s.batch_year = p_batch_year)
       and (p_semester is null or s.semester = p_semester)
       and (p_academic_year is null or s.academic_year = p_academic_year)
       and (not p_pinned_only or s.is_pinned)
       and (p_include_expired or not s.expired)
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
            or s.title ilike '%' || p_search || '%')
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


/*
  The publisher's list had the same shape of problem: can_edit_notice per row
  over every notice in the faculty. A publisher's own work is a small set and
  can be found by index first.
*/
create or replace function public.get_manageable_notices(
  p_status text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  title text,
  category text,
  category_label text,
  department text,
  batch_year integer,
  semester integer,
  academic_year text,
  course_code text,
  status text,
  is_pinned boolean,
  published_at timestamptz,
  expires_at timestamptz,
  is_expired boolean,
  created_by_name text,
  attachment_count integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid       uuid := auth.uid();
  v_role      text := coalesce(public.get_my_role(), '');
  v_hod       text := public.my_hod_department();
  v_lecturer  uuid := public.my_lecturer_id();
  v_dept      text;
  v_offerings uuid[] := '{}';
begin
  if v_role = 'dept_admin' then
    v_dept := public.get_my_department();
  elsif v_hod is not null then
    v_dept := v_hod;
  end if;

  if v_lecturer is not null then
    select coalesce(array_agg(cl.offering_id), '{}'::uuid[]) into v_offerings
      from public.course_lecturers cl
     where cl.lecturer_id = v_lecturer and cl.is_active;
  end if;

  return query
  with mine as (
    select n.* from public.notices n
     where (
             n.created_by = v_uid
             or v_role = 'super_admin'
             or (v_dept is not null and n.department = v_dept)
             or (v_lecturer is not null and n.offering_id = any(v_offerings))
           )
       and (p_status is null or n.status = p_status)
       and (p_search is null or btrim(p_search) = ''
            or n.title ilike '%' || p_search || '%')
  )
  select m.id, m.title, m.category, cat.label,
         m.department, m.batch_year, m.semester, m.academic_year,
         c.course_code, m.status, m.is_pinned, m.published_at, m.expires_at,
         (m.expires_at is not null and m.expires_at <= now()),
         m.created_by_name,
         (select count(*)::int from public.notice_attachments a
           where a.notice_id = m.id),
         count(*) over ()
    from mine m
    join public.notice_categories cat on cat.slug = m.category
    left join public.course_offerings o on o.id = m.offering_id
    left join public.courses c on c.id = o.course_id
   order by m.status = 'draft' desc, m.updated_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

grant execute on function public.get_manageable_notices(text, text, integer, integer)
  to authenticated;