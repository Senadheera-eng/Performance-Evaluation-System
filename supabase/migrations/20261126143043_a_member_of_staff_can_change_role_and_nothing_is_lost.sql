-- The Super Admin can change a member of staff's role: Lecturer, Department
-- Admin or Super Admin. Nothing is deleted.
--
-- A person's role lives in one of two tables: admins, keyed by their sign-in
-- account, or lecturers, which points at it. Moving between them:
--
--   * Lecturer to admin: the lecturer record lets go of the account and is
--     marked 'former'. It stays, with every course, result and feedback
--     answer that names it; it just no longer signs anyone in.
--   * Admin to lecturer: the admin record is marked 'former' (it is keyed by
--     the account, so it cannot let go). Their earlier lecturer record, if
--     they had one, takes the account back; otherwise a new one is made.
--   * Department Admin and Super Admin: the same record, a new role.
--
-- 'former' is not 'inactive'. Inactive is a deactivated account: signed out
-- and barred. A former record only means the person now holds their role
-- elsewhere. Every right in the database already asks for an 'active'
-- record, so a former one grants nothing.
--
-- Each change is kept in staff_role_changes: who, from what, to what, by
-- whom and why.

alter table public.admins drop constraint admins_status_check;
alter table public.admins add constraint admins_status_check
  check (status in ('active', 'inactive', 'former'));
alter table public.lecturers drop constraint lecturers_status_check;
alter table public.lecturers add constraint lecturers_status_check
  check (status in ('active', 'inactive', 'former'));

create table if not exists public.staff_role_changes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  from_role       text not null check (from_role in ('lecturer', 'dept_admin', 'super_admin')),
  to_role         text not null check (to_role in ('lecturer', 'dept_admin', 'super_admin')),
  from_department text,
  to_department   text,
  -- The lecturer record the person left or took back, so a later move back
  -- to lecturer finds it again.
  lecturer_id     uuid references public.lecturers (id) on delete set null,
  reason          text,
  changed_by      uuid,
  changed_at      timestamptz not null default now()
);
create index if not exists staff_role_changes_user_idx
  on public.staff_role_changes (user_id, changed_at desc);
alter table public.staff_role_changes enable row level security;
drop policy if exists staff_role_changes_super_admin_read on public.staff_role_changes;
create policy staff_role_changes_super_admin_read on public.staff_role_changes
  for select to authenticated
  using (public.is_super_admin());

/* The one role an account holds now, with the same precedence as
   get_my_role(): an active admin record first, then an active lecturer. */
create or replace function public.staff_role_of(p_user uuid)
returns table (role text, department text, name text, email text, lecturer_id uuid)
language sql
stable security definer
set search_path to 'public'
as $function$
  select a.role, a.department, a.name, a.email, null::uuid
    from public.admins a
   where a.id = p_user and a.status = 'active'
  union all
  select 'lecturer', l.department,
         case when coalesce(l.title, '') <> '' then l.title || ' ' || l.name else l.name end,
         l.email, l.id
    from public.lecturers l
   where l.auth_user_id = p_user and l.status = 'active'
     and not exists (select 1 from public.admins a where a.id = p_user and a.status = 'active')
  limit 1;
$function$;
revoke all on function public.staff_role_of(uuid) from public, anon, authenticated;

/* What the Super Admin needs to see before changing someone's role. */
create or replace function public.admin_staff_role_preview(p_user uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v         record;
  v_hod     text;
  v_mentees integer := 0;
  v_courses integer := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can change roles';
  end if;

  select * into v from public.staff_role_of(p_user);
  if v.role is null then
    raise exception 'Only a lecturer, department admin or Super Admin can have their role changed';
  end if;

  if v.lecturer_id is not null then
    select h.department into v_hod
      from public.hod_appointments h
     where h.lecturer_id = v.lecturer_id and h.is_active
     limit 1;
    select count(*) into v_mentees
      from public.mentor_assignments m
     where m.mentor_id = v.lecturer_id and m.ended_at is null;
    select count(*) into v_courses
      from public.course_lecturers c
     where c.lecturer_id = v.lecturer_id and c.is_active;
  end if;

  return jsonb_build_object(
    'name', v.name,
    'role', v.role,
    'department', v.department,
    'is_self', p_user = auth.uid(),
    'deactivated', not public.account_is_active(p_user),
    'hod_department', v_hod,
    'active_mentees', v_mentees,
    'current_courses', v_courses,
    'other_super_admins', (
      select count(*) from public.admins a
       where a.role = 'super_admin' and a.status = 'active'
         and a.id <> p_user and public.account_is_active(a.id)));
end;
$function$;
revoke all on function public.admin_staff_role_preview(uuid) from public, anon;
grant execute on function public.admin_staff_role_preview(uuid) to authenticated;

create or replace function public.admin_change_staff_role(
  p_user       uuid,
  p_role       text,
  p_department text default null,
  p_reason     text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v            record;
  v_department text := nullif(btrim(coalesce(p_department, '')), '');
  v_reason     text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
  v_label      text;
  v_email      text;
  v_hod        text;
  v_mentees    integer;
  v_avatar     text;
  v_lecturer   uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can change roles';
  end if;
  if p_user is null or p_user = auth.uid() then
    raise exception 'You cannot change your own role. Another Super Admin can.';
  end if;
  if p_role is null or p_role not in ('lecturer', 'dept_admin', 'super_admin') then
    raise exception 'Choose Lecturer, Department Admin or Super Admin';
  end if;
  v_label := case p_role when 'lecturer' then 'a Lecturer'
                         when 'dept_admin' then 'a Department Admin'
                         else 'a Super Admin' end;

  -- The Super Admin looks after the whole faculty; the other two belong to
  -- a department.
  if p_role = 'super_admin' then
    v_department := null;
  elsif v_department is null or v_department not in (
      'Civil Engineering', 'Computer Engineering', 'Electrical and Electronic Engineering',
      'Mechanical Engineering', 'Interdisciplinary Studies') then
    raise exception 'Choose the department';
  end if;

  -- One change to a person at a time.
  perform pg_advisory_xact_lock(hashtext('pes.staff_role:' || p_user::text));
  perform 1 from public.admins where id = p_user for update;
  perform 1 from public.lecturers where auth_user_id = p_user for update;

  select * into v from public.staff_role_of(p_user);
  if v.role is null then
    raise exception 'Only a lecturer, department admin or Super Admin can have their role changed';
  end if;
  if not public.account_is_active(p_user) then
    raise exception '%''s account is deactivated. Reactivate it first.', v.name;
  end if;
  if v.role = p_role and (p_role <> 'dept_admin' or v.department is not distinct from v_department) then
    raise exception '%', format('%s is already %s%s.', v.name, v_label,
      case when p_role = 'dept_admin' then ' for ' || v.department else '' end);
  end if;

  select u.email into v_email from auth.users u where u.id = p_user;
  v_email := lower(coalesce(v_email, v.email));

  -- Leaving the lecturer role: duties only a lecturer can carry are handed
  -- on first, so no student is left without a head or a mentor.
  if v.role = 'lecturer' then
    select h.department into v_hod
      from public.hod_appointments h
     where h.lecturer_id = v.lecturer_id and h.is_active
     limit 1;
    if v_hod is not null then
      raise exception '% is Head of %. Appoint another head on Heads of Department first.', v.name, v_hod;
    end if;
    select count(*) into v_mentees
      from public.mentor_assignments m
     where m.mentor_id = v.lecturer_id and m.ended_at is null;
    if v_mentees > 0 then
      raise exception '% mentors % student(s). The Head of % moves them to another mentor first.',
        v.name, v_mentees, v.department;
    end if;
  end if;

  -- Somebody must still be able to manage PES.
  if v.role = 'super_admin' and p_role <> 'super_admin' and not exists (
      select 1 from public.admins a
       where a.role = 'super_admin' and a.status = 'active'
         and a.id <> p_user and public.account_is_active(a.id)) then
    raise exception 'PES needs at least one Super Admin.';
  end if;

  if v.role = 'lecturer' then
    -- Lecturer to admin. The lecturer record stays, without the account.
    select l.avatar_url into v_avatar from public.lecturers l where l.id = v.lecturer_id;
    update public.lecturers
       set auth_user_id = null, status = 'former', updated_at = now()
     where id = v.lecturer_id;
    insert into public.admins (id, name, email, role, department, status, avatar_url)
    values (p_user, v.name, v_email, p_role, v_department, 'active', v_avatar)
    on conflict (id) do update
       set name = excluded.name,
           role = excluded.role,
           department = excluded.department,
           status = 'active',
           avatar_url = coalesce(excluded.avatar_url, public.admins.avatar_url);
    v_lecturer := v.lecturer_id;

  elsif p_role = 'lecturer' then
    -- Admin to lecturer. The admin record stays, marked former.
    select a.avatar_url into v_avatar from public.admins a where a.id = p_user;
    update public.admins set status = 'former' where id = p_user;

    -- Their own earlier lecturer record, if they were a lecturer before.
    select c.lecturer_id into v_lecturer
      from public.staff_role_changes c
      join public.lecturers l on l.id = c.lecturer_id
     where c.user_id = p_user and l.auth_user_id is null
     order by c.changed_at desc
     limit 1;
    if v_lecturer is null then
      select l.id into v_lecturer
        from public.lecturers l
       where lower(l.email) = v_email and l.auth_user_id is null
       limit 1;
    end if;
    if v_lecturer is null and exists (
        select 1 from public.lecturers l where lower(l.email) = v_email) then
      raise exception 'Another lecturer record already uses %, so a lecturer record cannot be made for this account.', v_email;
    end if;

    if v_lecturer is not null then
      update public.lecturers
         set auth_user_id = p_user, status = 'active', department = v_department,
             avatar_url = coalesce(v_avatar, avatar_url), updated_at = now()
       where id = v_lecturer;
    else
      insert into public.lecturers (name, email, department, status, auth_user_id, avatar_url)
      values (v.name, v_email, v_department, 'active', p_user, v_avatar)
      returning id into v_lecturer;
    end if;

  else
    -- Department Admin and Super Admin: the same record.
    update public.admins
       set role = p_role, department = v_department
     where id = p_user;
  end if;

  insert into public.staff_role_changes
    (user_id, from_role, to_role, from_department, to_department, lecturer_id, reason, changed_by)
  values
    (p_user, v.role, p_role, v.department, v_department, v_lecturer, v_reason, auth.uid());

  return jsonb_build_object(
    'ok', true,
    'from_role', v.role,
    'to_role', p_role,
    'department', v_department,
    'message', case
      when v.role = p_role then
        format('%s now looks after %s.', v.name, v_department)
      else
        format('%s is now %s%s. PES signs them out, and they see their new pages when they sign in again.',
               v.name, v_label,
               case when v_department is not null then ' in ' || v_department else '' end)
      end);
end;
$function$;
revoke all on function public.admin_change_staff_role(uuid, text, text, text) from public, anon;
grant execute on function public.admin_change_staff_role(uuid, text, text, text) to authenticated;

/* The signed-in person's role and department as the database sees them, so
   a browser that is already signed in notices a change made since. */
create or replace function public.my_access()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object('role', public.get_my_role(), 'department', public.get_my_department());
$function$;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

/* A former record is not a deactivated account: only 'inactive' signs out. */
create or replace function public.my_account_active()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null
     and public.account_is_active(auth.uid())
     and not exists (select 1 from public.admins a where a.id = auth.uid() and a.status = 'inactive')
     and not exists (select 1 from public.lecturers l where l.auth_user_id = auth.uid() and l.status = 'inactive');
$function$;

/* The photo and name go on the record the person uses now. */
create or replace function public.set_my_avatar(p_url text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in first.';
  end if;
  if p_url is not null
     and p_url !~ ('/storage/v1/object/public/avatars/' || v_uid::text || '(\?.*)?$') then
    raise exception 'That is not your photo.';
  end if;

  update public.admins set avatar_url = p_url where id = v_uid and status <> 'former';
  if found then return; end if;

  update public.lecturers set avatar_url = p_url, updated_at = now()
   where auth_user_id = v_uid;
  if found then return; end if;

  update public.students set avatar_url = p_url where id = v_uid;
  if not found then
    raise exception 'This account has no profile to put a photo on.';
  end if;
end;
$function$;

create or replace function public.update_my_admin_profile(p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if length(v_name) < 3 or length(v_name) > 120 then
    raise exception 'Your name must be between 3 and 120 characters.';
  end if;

  update public.admins set name = v_name where id = auth.uid() and status <> 'former';
  if not found then
    raise exception 'Only an admin can change an admin profile.';
  end if;
end;
$function$;

create or replace function public.get_avatar_urls(p_ids uuid[])
returns table(id uuid, avatar_url text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select s.id, s.avatar_url
    from public.students s
   where s.id = any(p_ids) and s.avatar_url is not null
  union all
  select l.id, l.avatar_url
    from public.lecturers l
   where l.id = any(p_ids) and l.avatar_url is not null
  union all
  select l.auth_user_id, l.avatar_url
    from public.lecturers l
   where l.auth_user_id = any(p_ids) and l.avatar_url is not null
     and l.auth_user_id is not null
  union all
  select a.id, a.avatar_url
    from public.admins a
   where a.id = any(p_ids) and a.avatar_url is not null and a.status <> 'former';
$function$;

create or replace function public.get_faculty_site_status()
returns table(pages_known integer, pages_read integer, pages_pending integer, pages_failed integer, sections integer, last_read_at timestamp with time zone)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from public.admins a
     where a.id = auth.uid() and a.role = 'super_admin' and a.status = 'active'
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
$function$;

/* The Users list shows each person once, in the role they hold now. */
create or replace function public.admin_list_users()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can manage users';
  end if;

  return coalesce((
    with people as (
      select s.id as user_id, 'student'::text as kind, s.name, s.email, s.department,
             jsonb_build_object('reg_number', s.reg_number, 'index_number', s.index_number,
                                'batch_year', s.batch_year, 'academic_status', s.status) as detail,
             false as profile_inactive
        from public.students s
      union all
      select l.auth_user_id, 'lecturer', case when l.title is not null and l.title <> '' then l.title || ' ' || l.name else l.name end,
             l.email, l.department,
             jsonb_build_object('lecturer_id', l.id, 'staff_no', l.staff_no),
             l.status <> 'active'
        from public.lecturers l
       where l.status <> 'former'
      union all
      select a.id, a.role, a.name, a.email, a.department, '{}'::jsonb, a.status <> 'active'
        from public.admins a
       where a.status <> 'former'
    ),
    invites as (
      select distinct on (t.user_id) t.user_id, t.expires_at, t.created_at
        from public.account_tokens t
       where t.purpose = 'invite' and t.used_at is null
       order by t.user_id, t.created_at desc
    )
    select jsonb_agg(jsonb_build_object(
             'user_id', p.user_id,
             'kind', p.kind,
             'name', p.name,
             'email', coalesce(u.email, p.email),
             'department', p.department,
             'detail', p.detail,
             'state', case
                        when p.user_id is null then 'no_account'
                        when d.user_id is not null or p.profile_inactive then 'deactivated'
                        when coalesce(u.encrypted_password, '') = '' then
                          case when i.expires_at > now() then 'invited' else 'invite_expired' end
                        else 'active'
                      end,
             'last_sign_in_at', u.last_sign_in_at,
             'invited_at', i.created_at,
             'invite_expires_at', i.expires_at,
             'deactivated_at', d.deactivated_at,
             'deactivation_reason', d.reason)
           order by p.kind, p.name)
      from people p
      left join auth.users u on u.id = p.user_id
      left join invites i on i.user_id = p.user_id
      left join public.account_deactivations d on d.user_id = p.user_id
  ), '[]'::jsonb);
end;
$function$;
