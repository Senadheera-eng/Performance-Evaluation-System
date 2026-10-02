-- Whether a sign-in account has a password yet. An invited account has none
-- until its owner sets one from the link; this is what tells an invitation
-- that may still be cancelled from an account that is in use. Only the
-- account edge function (service role) may ask.
create or replace function public.account_has_password(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select coalesce(u.encrypted_password, '') <> '' from auth.users u where u.id = p_user), false);
$$;
revoke all on function public.account_has_password(uuid) from public, anon, authenticated;
grant execute on function public.account_has_password(uuid) to service_role;
