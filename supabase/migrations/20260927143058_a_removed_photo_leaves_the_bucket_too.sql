-- Removing a profile photo cleared the address on the profile, but the file
-- stayed in the public avatars bucket: there was an insert, update and
-- select policy for one's own avatar, and no delete. The same rule as the
-- others — one's own path only — so "Remove" removes.
create policy "Users can delete own avatar"
  on storage.objects
  for delete
  to authenticated
  using ((bucket_id = 'avatars'::text) and (name = ((select auth.uid()))::text));
