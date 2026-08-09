-- harden_avatar_storage_policies
-- Applied 20260725075352
-- Exported from the live project; do not edit by hand.


-- The avatars bucket carried two pairs of policies: correctly scoped ones
-- (name = auth.uid()) alongside blanket ones matching only bucket_id.
-- Postgres ORs permissive policies together, so the blanket versions fully
-- negated the scoped ones — any authenticated user could overwrite any
-- other user's avatar by uploading to their UID as the filename, and could
-- list every object in the bucket (enumerating all user IDs).
--
-- Dropping these does not affect avatar display: the app stores images via
-- getPublicUrl() and the bucket is public, so images are served over the
-- /object/public/ path, which does not consult RLS at all.
DROP POLICY IF EXISTS "Avatar upload" ON storage.objects;
DROP POLICY IF EXISTS "Avatar update" ON storage.objects;
DROP POLICY IF EXISTS "Avatar view" ON storage.objects;
DROP POLICY IF EXISTS "Avatars are publicly viewable" ON storage.objects;

-- Authenticated listing/metadata reads stay possible for a user's own
-- avatar object only, so the bucket can no longer be enumerated.
CREATE POLICY "Students view own avatar object"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars' AND name = auth.uid()::text);
