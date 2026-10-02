-- Accounts: invitations, password resets, and deactivation.
--
-- The Super Admin invites a student, lecturer or department admin by email;
-- the invitee sets their own password from a single-use, time-limited link.
-- Anyone can ask for a password-reset link, which goes to the email their
-- account is registered with. And any account below the Super Admin can be
-- deactivated -- access revoked, nothing deleted -- and reactivated.
--
-- The account edge function does the work with the service role; these
-- tables are not readable by anyone else.

-- One-time links. Only a SHA-256 hash of each token is kept, so a copy of
-- this table cannot be used to sign in as anyone.
create table public.account_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (purpose in ('invite', 'reset')),
  token_hash text not null unique,
  sent_to text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index account_tokens_open_idx on public.account_tokens (user_id, purpose) where used_at is null;
alter table public.account_tokens enable row level security;
revoke all on public.account_tokens from anon, authenticated;

-- What has been asked for recently, for rate limits. The subject is a hash
-- of an email, an IP address or an admin's id -- never the value itself.
create table public.account_request_log (
  id bigint generated always as identity primary key,
  kind text not null,
  subject text not null,
  created_at timestamptz not null default now()
);
create index account_request_log_idx on public.account_request_log (kind, subject, created_at desc);
alter table public.account_request_log enable row level security;
revoke all on public.account_request_log from anon, authenticated;

-- Deactivated accounts. A row here, not a deleted account: the person's
-- results, attendance, feedback and enrolments stay exactly as they were.
create table public.account_deactivations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  deactivated_at timestamptz not null default now(),
  deactivated_by uuid references auth.users (id) on delete set null,
  reason text
);
alter table public.account_deactivations enable row level security;
revoke all on public.account_deactivations from anon, authenticated;

create or replace function public.account_is_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null
     and not exists (select 1 from public.account_deactivations d where d.user_id = p_user);
$$;
revoke all on function public.account_is_active(uuid) from public, anon;
grant execute on function public.account_is_active(uuid) to authenticated, service_role;

-- Deactivation takes effect at once, not when the login token next expires:
-- every admin rule and function goes through these helpers, and they now
-- refuse a deactivated account and an admin whose status is not active.
create or replace function public.get_my_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not public.account_is_active(auth.uid()) then
    return '';
  end if;
  select role into v_role from public.admins where id = auth.uid() and status = 'active';
  if v_role is not null then
    return v_role;
  end if;
  select role into v_role from public.students where id = auth.uid();
  if v_role is not null then
    return v_role;
  end if;
  -- A lecturer holds no row in either table, and a signed-out caller holds
  -- no row anywhere. Both are "not an administrator", and saying so as a
  -- value rather than as NULL is what keeps NOT IN comparisons honest.
  return '';
end;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_is_active(auth.uid())
     and exists (select 1 from public.admins a
                  where a.id = auth.uid() and a.role = 'super_admin' and a.status = 'active');
$$;

create or replace function public.my_lecturer_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.account_is_active(auth.uid()) then
    return null;
  end if;
  select id into v_id from public.lecturers
   where auth_user_id = auth.uid() and status = 'active';
  return v_id;
end;
$$;

create or replace function public.get_my_department()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_department text;
begin
  select department into v_department from admins where id = auth.uid() and status = 'active';
  if v_department is not null then
    return v_department;
  end if;
  select department into v_department from students where id = auth.uid();
  return v_department;
end;
$$;

-- Notifications for a department's admins go only to admins who can read them.
create or replace function public.department_admin_ids(p_department text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(a.id), '{}'::uuid[])
    from public.admins a
   where a.status = 'active'
     and public.account_is_active(a.id)
     and (a.role = 'super_admin'
          or (a.role = 'dept_admin' and a.department is not distinct from p_department))
$$;

-- For the app: is the signed-in account still allowed in? Checked on sign-in
-- and while the app is open, so a deactivated person is signed out at once.
create or replace function public.my_account_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and public.account_is_active(auth.uid())
     and not exists (select 1 from public.admins a where a.id = auth.uid() and a.status <> 'active')
     and not exists (select 1 from public.lecturers l where l.auth_user_id = auth.uid() and l.status <> 'active');
$$;
revoke all on function public.my_account_active() from public, anon;
grant execute on function public.my_account_active() to authenticated;

-- Everyone who can sign in to PES, and every lecturer who could, with the
-- state of their account. For the Super Admin's Users page.
create or replace function public.admin_list_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
      union all
      select a.id, a.role, a.name, a.email, a.department, '{}'::jsonb, a.status <> 'active'
        from public.admins a
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
$$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
