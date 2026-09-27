-- A lecturer can keep their own profile: the title and name they are shown
-- by, and a photo. Everything else about them (email, which is their
-- sign-in; department, which decides what they may see; staff number)
-- stays the department's to change.
--
-- Photos live in the public avatars bucket at avatars/<auth uid>, the path
-- the storage policies already confine each user to. Students have always
-- had students.avatar_url; lecturers get the same column.

alter table public.lecturers add column if not exists avatar_url text;

/* The caller's own lecturer row, and only that. The lecturers table has no
   self-update policy on purpose (a policy would let them change their
   department too), so the two editable fields go through here. */
create or replace function public.update_my_lecturer_profile(
  p_title text,
  p_name  text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_name  text := btrim(coalesce(p_name, ''));
begin
  if v_title is not null
     and v_title not in ('Prof.', 'Dr.', 'Eng.', 'Mr.', 'Mrs.', 'Ms.') then
    raise exception 'Choose a title from the list.';
  end if;
  if length(v_name) < 3 or length(v_name) > 120 then
    raise exception 'Your name must be between 3 and 120 characters.';
  end if;

  update public.lecturers
     set title = v_title, name = v_name, updated_at = now()
   where auth_user_id = auth.uid();
  if not found then
    raise exception 'Only a lecturer can change a lecturer profile.';
  end if;
end;
$$;

/* Sets or clears the caller's photo. The address must point into their own
   folder of the avatars bucket, so nobody can borrow another picture. A
   query string (the ?v= that makes browsers fetch a changed photo) is
   allowed after it. */
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

  update public.lecturers set avatar_url = p_url, updated_at = now()
   where auth_user_id = v_uid;
  if found then return; end if;

  update public.students set avatar_url = p_url where id = v_uid;
  if not found then
    raise exception 'This account has no profile to put a photo on.';
  end if;
end;
$$;

/* Photo addresses for the people a page is showing, by any id it has for
   them: a student id, a lecturer id, or a lecturer's sign-in id. The images
   are in a public bucket already, so this reveals nothing an address did
   not; it only saves every list from knowing which table a person is in. */
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
     and l.auth_user_id is not null;
$$;

revoke execute on function public.update_my_lecturer_profile(text, text) from public, anon;
revoke execute on function public.set_my_avatar(text) from public, anon;
revoke execute on function public.get_avatar_urls(uuid[]) from public, anon;
grant execute on function public.update_my_lecturer_profile(text, text) to authenticated;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.get_avatar_urls(uuid[]) to authenticated;
