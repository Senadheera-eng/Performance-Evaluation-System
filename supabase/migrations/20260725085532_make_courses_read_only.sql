-- make_courses_read_only
-- Applied 20260725085532
-- Exported from the live project; do not edit by hand.


-- The course catalogue is authoritative curriculum data taken from the
-- Faculty Handbook; nothing in the app writes to it. Admins (department
-- and super) now have read-only access, so a course name or credit value
-- can't be altered through the API. Curriculum changes are made through
-- migrations, which keeps them reviewable and version-controlled.
DROP POLICY IF EXISTS courses_dept_admin_own_department ON public.courses;
DROP POLICY IF EXISTS courses_super_admin_all ON public.courses;

-- "Anyone can view courses" and courses_public_read were byte-identical
-- (both `USING (true)`); keep one.
DROP POLICY IF EXISTS "Anyone can view courses" ON public.courses;
