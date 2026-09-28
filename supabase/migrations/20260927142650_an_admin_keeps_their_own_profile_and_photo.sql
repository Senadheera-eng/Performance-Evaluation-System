-- An admin — the faculty's or a department's — can keep their own profile:
-- the name they are shown by, and a photo, as lecturers and students can.
-- Their role and department decide what they may see and change, so those
-- stay the database's to set; only the name and photo go through here.
--
-- Photos live in the public avatars bucket at avatars/<auth uid>, the path
-- the storage policies already confine each user to.

alter table public.admins add column if not exists avatar_url text;

/* The caller's own admin row, and only that. admins has no self-update
   policy on purpose (a policy would let them change their role too). */
create or replace function public.update_my_admin_profile(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if length(v_name) < 3 or length(v_name) > 120 then
    raise exception 'Your name must be between 3 and 120 characters.';
  end if;

  update public.admins set name = v_name where id = auth.uid();
  if not found then
    raise exception 'Only an admin can change an admin profile.';
  end if;
end;
$$;

/* Sets or clears the caller's photo, now for admins as well. The address
   must point into their own folder of the avatars bucket. */
create or replace function public.set_my_avatar(p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  update public.admins set avatar_url = p_url where id = v_uid;
  if found then return; end if;

  update public.lecturers set avatar_url = p_url, updated_at = now()
   where auth_user_id = v_uid;
  if found then return; end if;

  update public.students set avatar_url = p_url where id = v_uid;
  if not found then
    raise exception 'This account has no profile to put a photo on.';
  end if;
end;
$$;

/* Photo addresses for the people a page is showing — now admins too. */
create or replace function public.get_avatar_urls(p_ids uuid[])
returns table (id uuid, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
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
   where a.id = any(p_ids) and a.avatar_url is not null;
$$;

revoke execute on function public.update_my_admin_profile(text) from public, anon;
revoke execute on function public.set_my_avatar(text) from public, anon;
revoke execute on function public.get_avatar_urls(uuid[]) from public, anon;
grant execute on function public.update_my_admin_profile(text) to authenticated;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.get_avatar_urls(uuid[]) to authenticated;
