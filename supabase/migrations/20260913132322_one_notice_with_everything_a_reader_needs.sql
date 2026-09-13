/*
  A single notice, and the list a publisher manages.

  Both go through functions rather than embedded PostgREST selects: the
  category label, the course code and the attachments come from three
  different tables, and asking the client to stitch them means three round
  trips to render one card.
*/

create or replace function public.get_notice(p_id uuid)
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
  can_edit boolean,
  attachments jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id, n.title, n.category, cat.label, cat.icon, n.body,
         n.department, n.batch_year, n.semester, n.academic_year,
         n.offering_id, c.course_code, c.title,
         n.status, n.is_pinned, n.published_at, n.expires_at,
         (n.expires_at is not null and n.expires_at <= now()),
         n.created_by_name, n.created_by_role,
         public.can_edit_notice(n.id),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', a.id, 'path', a.path, 'file_name', a.file_name,
                    'mime_type', a.mime_type, 'size_bytes', a.size_bytes)
                  order by a.sort_order, a.uploaded_at)
             from public.notice_attachments a where a.notice_id = n.id
         ), '[]'::jsonb)
    from public.notices n
    join public.notice_categories cat on cat.slug = n.category
    left join public.course_offerings o on o.id = n.offering_id
    left join public.courses c on c.id = o.course_id
   where n.id = p_id
     and public.notice_visible_to_me(n.id)
$$;

grant execute on function public.get_notice(uuid) to authenticated;


/**
 * What this publisher has filed, drafts included.
 *
 * Separate from get_my_notices because the questions differ: a reader wants
 * what is live and aimed at them, a publisher wants their own work whatever
 * state it is in, including the draft nobody else can see.
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
language sql
stable
security definer
set search_path to 'public'
as $$
  with mine as (
    select n.* from public.notices n
     where public.can_edit_notice(n.id)
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
  offset greatest(0, coalesce(p_offset, 0))
$$;

grant execute on function public.get_manageable_notices(text, text, integer, integer)
  to authenticated;


/**
 * Which categories and scopes this publisher may actually use.
 *
 * The create form asks the database what it is allowed to offer rather than
 * reproducing the hierarchy in TypeScript — there is one rule, and a second
 * copy in the client would be a second rule waiting to disagree with it.
 */
create or replace function public.get_my_notice_publishing_scope()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role     text := coalesce(public.get_my_role(), '');
  v_hod      text := public.my_hod_department();
  v_lecturer uuid := public.my_lecturer_id();
  v_dept     text;
  v_kind     text;
begin
  if v_role = 'super_admin' then
    v_kind := 'super_admin';
  elsif v_role = 'dept_admin' then
    v_kind := 'dept_admin'; v_dept := public.get_my_department();
  elsif v_hod is not null then
    v_kind := 'hod'; v_dept := v_hod;
  elsif v_lecturer is not null then
    v_kind := 'lecturer';
    select l.department into v_dept from public.lecturers l where l.id = v_lecturer;
  else
    return jsonb_build_object('can_publish', false, 'kind', 'none',
                              'categories', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'can_publish', true,
    'kind', v_kind,
    'department', v_dept,
    /* Faculty-wide is the super admin's alone; everyone else is pinned to
       their department, which the form shows as fixed rather than offering
       a choice the database would then refuse. */
    'can_target_faculty', v_kind = 'super_admin',
    'must_target_offering', v_kind = 'lecturer',
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug', slug, 'label', label, 'icon', icon) order by sort_order), '[]'::jsonb)
        from public.notice_categories
       where is_active
         and public.can_publish_notice_scope(
               case when v_kind = 'super_admin' then null else v_dept end,
               null,
               null,
               slug)
    ),
    /* A lecturer's categories depend on naming an offering, which the check
       above cannot know about, so they are listed separately. */
    'offering_categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug', slug, 'label', label, 'icon', icon) order by sort_order), '[]'::jsonb)
        from public.notice_categories
       where is_active
         and min_publisher in ('lecturer')
    )
  );
end;
$$;

grant execute on function public.get_my_notice_publishing_scope() to authenticated;